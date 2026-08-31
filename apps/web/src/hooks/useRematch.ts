/**
 * Rematch hook (MPG-015) — the client half of the result → rematch flow.
 *
 * Turns `rematch:propose`/`rematch:decline` intents into acked Socket.IO
 * emits, and tracks the negotiation as it evolves via the server's
 * `rematch:proposed` / `rematch:declined` / `rematch:start` broadcasts
 * (docs/API_SPEC.md). The server is authoritative for when a rematch is
 * actually mutual — this hook never assumes a rematch started until told.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { getSocket } from "../api/socket.js";
import type { RoomErrorPayload, Slot } from "../api/roomTypes.js";

type Ack<T> = { ok: true; data: T } | { ok: false; error: RoomErrorPayload };

function isAckResponse<T>(value: unknown): value is Ack<T> {
  return typeof value === "object" && value !== null && "ok" in value;
}

export interface UseRematchResult {
  /** This client has proposed a rematch and is waiting on the other seat(s). */
  rematchProposed: boolean;
  /** Another seat has proposed a rematch; this client hasn't responded yet. */
  opponentProposed: boolean;
  /** Every human seat proposed — a fresh room was created (see `newRoomId`). */
  rematchAccepted: boolean;
  /** The freshly-created room's ID, once `rematchAccepted` is true. */
  newRoomId: string | undefined;
  error: RoomErrorPayload | undefined;
  clearError: () => void;
  proposeRematch: () => void;
  declineRematch: () => void;
  /** Clears all local rematch state (e.g. after navigating away). */
  reset: () => void;
}

/**
 * `roomId`/`sessionToken`/`yourSlot` — identify which room/seat this client is
 * proposing/declining for; typically sourced straight from `useRoom()`'s
 * result once a game has finished. `onRematchStart` fires once with the new
 * room's ID when the rematch is mutual — callers navigate there.
 */
export function useRematch(
  roomId: string | undefined,
  sessionToken: string | undefined,
  yourSlot: Slot | undefined,
  onRematchStart?: (newRoomId: string) => void,
): UseRematchResult {
  const [rematchProposed, setRematchProposed] = useState(false);
  const [opponentProposed, setOpponentProposed] = useState(false);
  const [rematchAccepted, setRematchAccepted] = useState(false);
  const [newRoomId, setNewRoomId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<RoomErrorPayload | undefined>(undefined);

  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const sessionTokenRef = useRef(sessionToken);
  sessionTokenRef.current = sessionToken;
  const yourSlotRef = useRef(yourSlot);
  yourSlotRef.current = yourSlot;
  const onRematchStartRef = useRef(onRematchStart);
  onRematchStartRef.current = onRematchStart;

  const reset = useCallback(() => {
    setRematchProposed(false);
    setOpponentProposed(false);
    setRematchAccepted(false);
    setNewRoomId(undefined);
    setError(undefined);
  }, []);

  // A new roomId means a new negotiation — drop any stale state from the
  // previous game rather than carrying it over silently.
  useEffect(() => {
    reset();
  }, [roomId, reset]);

  useEffect(() => {
    const socket = getSocket();

    const handleProposed = (payload: { from: Slot }): void => {
      if (payload.from === yourSlotRef.current) {
        setRematchProposed(true);
      } else {
        setOpponentProposed(true);
      }
    };

    const handleDeclined = (): void => {
      setRematchProposed(false);
      setOpponentProposed(false);
    };

    const handleStart = (payload: { roomId: string }): void => {
      setRematchAccepted(true);
      setNewRoomId(payload.roomId);
      onRematchStartRef.current?.(payload.roomId);
    };

    const handleError = (payload: RoomErrorPayload): void => setError(payload);

    socket.on("rematch:proposed", handleProposed);
    socket.on("rematch:declined", handleDeclined);
    socket.on("rematch:start", handleStart);
    socket.on("rematch:error", handleError);

    return () => {
      socket.off("rematch:proposed", handleProposed);
      socket.off("rematch:declined", handleDeclined);
      socket.off("rematch:start", handleStart);
      socket.off("rematch:error", handleError);
    };
  }, []);

  const proposeRematch = useCallback(() => {
    const currentRoomId = roomIdRef.current;
    const currentSessionToken = sessionTokenRef.current;
    if (!currentRoomId || !currentSessionToken) return;

    setError(undefined);
    const socket = getSocket();
    socket.emit(
      "rematch:propose",
      { roomId: currentRoomId, sessionToken: currentSessionToken },
      (response: unknown) => {
        if (isAckResponse(response) && !response.ok) setError(response.error);
      },
    );
  }, []);

  const declineRematch = useCallback(() => {
    const currentRoomId = roomIdRef.current;
    const currentSessionToken = sessionTokenRef.current;
    if (!currentRoomId || !currentSessionToken) return;

    setError(undefined);
    const socket = getSocket();
    socket.emit(
      "rematch:decline",
      { roomId: currentRoomId, sessionToken: currentSessionToken },
      (response: unknown) => {
        if (isAckResponse(response) && !response.ok) setError(response.error);
      },
    );
    setRematchProposed(false);
  }, []);

  const clearError = useCallback(() => setError(undefined), []);

  return {
    rematchProposed,
    opponentProposed,
    rematchAccepted,
    newRoomId,
    error,
    clearError,
    proposeRematch,
    declineRematch,
    reset,
  };
}
