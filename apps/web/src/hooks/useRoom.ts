/**
 * Room lifecycle hook (MPG-012) — the client half of create/invite/join.
 *
 * Owns the socket connection lifecycle (connects lazily on first use, one
 * connection per tab via `../api/socket.ts`), turns `room:create`/`room:join`/
 * `room:leave` intents into acked Socket.IO emits, and tracks the
 * authoritative `PublicRoom` as it evolves via the server's `room:updated`
 * broadcast (docs/API_SPEC.md). The server is authoritative for all seat
 * assignment — this hook never guesses a slot locally.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  connectSocket,
  getConnectionState,
  getSocket,
  onConnectionStateChange,
  type ConnectionState,
} from "../api/socket.js";
import type { PublicRoom, RoomErrorPayload, SeatConfigInput, Slot } from "../api/roomTypes.js";
import { reconcileUsername } from "../api/username.js";
import { storeCreatorToken } from "../api/watchSession.js";

type Ack<T> = { ok: true; data: T } | { ok: false; error: RoomErrorPayload };

function isAckResponse<T>(value: unknown): value is Ack<T> {
  return typeof value === "object" && value !== null && "ok" in value;
}

export interface UseRoomResult {
  room: PublicRoom | undefined;
  /** This client's seat, once known (from create/join or a later `room:updated`). */
  yourSlot: Slot | undefined;
  /** Per-room session token — identifies this seat across reconnects. */
  sessionToken: string | undefined;
  /**
   * MPG-025: this room's creator credential, present once `createRoom`
   * resolves (`room:created` always includes it — see docs/API_SPEC.md
   * §3.0). Lets the creator's socket watch-rejoin an all-bot room later
   * (`room:state({ roomId, creatorToken })`) — it's also persisted to
   * `sessionStorage` (`../api/watchSession.ts`) the moment it's known, so a
   * reload can recover it even before this hook re-initializes.
   */
  creatorToken: string | undefined;
  isConnected: boolean;
  connectionState: ConnectionState;
  error: RoomErrorPayload | undefined;
  clearError: () => void;
  createRoom: (gameId: string, seats: SeatConfigInput[]) => Promise<PublicRoom | undefined>;
  joinRoom: (roomId: string, opts?: { displayName?: string }) => Promise<PublicRoom | undefined>;
  leaveRoom: () => Promise<void>;
}

/**
 * `roomId` — if given, the hook does NOT auto-join (callers decide when,
 * typically after showing a "Joining…" state); it's only used to re-request
 * `room:state` if the socket reconnects mid-session so the UI never goes
 * stale silently.
 */
export function useRoom(roomId?: string): UseRoomResult {
  const [room, setRoom] = useState<PublicRoom | undefined>(undefined);
  const [yourSlot, setYourSlot] = useState<Slot | undefined>(undefined);
  const [sessionToken, setSessionToken] = useState<string | undefined>(undefined);
  const [creatorToken, setCreatorToken] = useState<string | undefined>(undefined);
  const [connectionState, setConnectionState] = useState<ConnectionState>(getConnectionState());
  const [error, setError] = useState<RoomErrorPayload | undefined>(undefined);

  // Kept in a ref too, so the `room:leave` cleanup path doesn't need to be a
  // dependency of the effect below (avoids re-subscribing on every update).
  const roomIdRef = useRef<string | undefined>(roomId);
  const sessionTokenRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = onConnectionStateChange(setConnectionState);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const handleUpdated = (payload: { room: PublicRoom }): void => {
      if (roomIdRef.current && payload.room.roomId !== roomIdRef.current) return;
      setRoom(payload.room);
    };
    const handleError = (payload: RoomErrorPayload): void => setError(payload);

    socket.on("room:updated", handleUpdated);
    socket.on("room:error", handleError);

    // Re-sync on (re)connect if we already know which room we're in — covers
    // the reconnect-after-drop case so the UI never shows stale seat state.
    const handleConnect = (): void => {
      if (roomIdRef.current) {
        socket.emit("room:state", { roomId: roomIdRef.current });
      }
    };
    socket.on("connect", handleConnect);

    return () => {
      socket.off("room:updated", handleUpdated);
      socket.off("room:error", handleError);
      socket.off("connect", handleConnect);
    };
  }, []);

  const createRoom = useCallback(
    (gameId: string, seats: SeatConfigInput[]): Promise<PublicRoom | undefined> => {
      setError(undefined);
      // Best-effort: retry a previously-unconfirmed username sync on this
      // natural server contact. Never awaited — must not delay room creation.
      void reconcileUsername();
      const socket = connectSocket();
      return new Promise((resolve) => {
        socket.emit("room:create", { gameId, seats }, (ack: unknown) => {
          if (
            isAckResponse<{
              room: PublicRoom;
              roomId: string;
              sessionToken?: string;
              yourSlot?: Slot;
              creatorToken?: string;
            }>(ack)
          ) {
            if (ack.ok) {
              roomIdRef.current = ack.data.roomId;
              sessionTokenRef.current = ack.data.sessionToken;
              setRoom(ack.data.room);
              setYourSlot(ack.data.yourSlot);
              setSessionToken(ack.data.sessionToken);
              setCreatorToken(ack.data.creatorToken);
              // MPG-025: persist immediately (not just in React state) so a
              // hard reload of an all-bot watch room — which has no seat/
              // sessionToken to reconnect with — can still recover this
              // credential and watch-rejoin (see `../api/watchSession.ts`).
              if (ack.data.creatorToken) {
                storeCreatorToken(ack.data.roomId, ack.data.creatorToken);
              }
              resolve(ack.data.room);
              return;
            }
            setError(ack.error);
          }
          resolve(undefined);
        });
      });
    },
    [],
  );

  const joinRoom = useCallback(
    (
      targetRoomId: string,
      opts: { displayName?: string } = {},
    ): Promise<PublicRoom | undefined> => {
      setError(undefined);
      // Best-effort: retry a previously-unconfirmed username sync on this
      // natural server contact. Never awaited — must not delay joining.
      void reconcileUsername();
      const socket = connectSocket();
      return new Promise((resolve) => {
        socket.emit(
          "room:join",
          { roomId: targetRoomId, displayName: opts.displayName },
          (ack: unknown) => {
            if (isAckResponse<{ room: PublicRoom; yourSlot: Slot; sessionToken: string }>(ack)) {
              if (ack.ok) {
                roomIdRef.current = targetRoomId;
                sessionTokenRef.current = ack.data.sessionToken;
                setRoom(ack.data.room);
                setYourSlot(ack.data.yourSlot);
                setSessionToken(ack.data.sessionToken);
                resolve(ack.data.room);
                return;
              }
              setError(ack.error);
            }
            resolve(undefined);
          },
        );
      });
    },
    [],
  );

  const leaveRoom = useCallback((): Promise<void> => {
    const currentRoomId = roomIdRef.current;
    const currentSessionToken = sessionTokenRef.current;
    if (!currentRoomId || !currentSessionToken) return Promise.resolve();

    const socket = getSocket();
    return new Promise((resolve) => {
      socket.emit(
        "room:leave",
        { roomId: currentRoomId, sessionToken: currentSessionToken },
        () => {
          roomIdRef.current = undefined;
          sessionTokenRef.current = undefined;
          setRoom(undefined);
          setYourSlot(undefined);
          setSessionToken(undefined);
          resolve();
        },
      );
    });
  }, []);

  const clearError = useCallback(() => setError(undefined), []);

  return {
    room,
    yourSlot,
    sessionToken,
    creatorToken,
    isConnected: connectionState === "connected",
    connectionState,
    error,
    clearError,
    createRoom,
    joinRoom,
    leaveRoom,
  };
}
