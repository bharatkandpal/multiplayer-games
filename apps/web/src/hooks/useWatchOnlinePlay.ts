/**
 * Read-only online-play net-layer hook (MPG-025) — the watch-only counterpart
 * to `useOnlinePlay`. An all-bot "watch" room has no seat for this client to
 * hold, so there's no `makeMove`/optimistic-apply/reconcile-on-own-move story
 * here at all: this hook only ever applies whatever the server broadcasts
 * (`game:start`/`game:update`/`game:over`), the same "apply the authoritative
 * state" half `useOnlinePlay` already has — see that hook's doc comment for
 * the full net-layer contract this is a deliberate subset of.
 *
 * No game-outcome authority lives here either: every move is entirely
 * server-driven (bot seats never touch the client — docs/API_SPEC.md §3.3),
 * this hook only reflects the server's broadcasts.
 */

import { useEffect, useRef, useState } from "react";
import type { GameModule, Player, Result } from "@mpg/engine";

import { getSocket } from "../api/socket.js";
import type { PublicRoom, Slot } from "../api/roomTypes.js";
import { publicRoomToSeats } from "../api/roomSeats.js";
import { useGameSession } from "../game/useGameSession";
import type { AppliedMove, GameSessionState } from "../game/gameSession";
import type { SeatsConfig } from "../game";

export type WatchPhase = "connecting" | "watching" | "finished";

export interface UseWatchOnlinePlayOptions<S, M, L = unknown> {
  game: GameModule<S, M, L>;
  roomId: string;
  /** MPG-025: this room's creator credential, for the `room:state` watch-rejoin
   * request below (see docs/API_SPEC.md §3.0) — omitted only if it was never
   * known (shouldn't happen for a room this tab created, but the request is
   * still sent without it, matching what the server does with a missing one:
   * a silent no-op that still returns a snapshot). */
  creatorToken: string | undefined;
  /** Optional room snapshot already known at mount (typically the just-created
   * room, straight from `room:create`'s ack) — lets watching start immediately
   * instead of waiting on a redundant `room:state` round-trip. */
  initialRoom?: PublicRoom | undefined;
}

export interface UseWatchOnlinePlayResult<S, M> {
  session: GameSessionState<S, M>;
  state: S;
  result: Result;
  turn: Player;
  /** The seats of the room being watched — every one a bot, by construction
   * (an MPG-025 watch room has no human seat). Empty while still connecting. */
  seats: SeatsConfig;
  moveLog: AppliedMove<M>[];
  phase: WatchPhase;
}

/**
 * Watches one all-bot online game to completion over the singleton socket
 * (`../api/socket.ts`). One instance per room.
 */
export function useWatchOnlinePlay<S, M, L = unknown>({
  game,
  roomId,
  creatorToken,
  initialRoom,
}: UseWatchOnlinePlayOptions<S, M, L>): UseWatchOnlinePlayResult<S, M> {
  const knownRoom = initialRoom?.roomId === roomId ? initialRoom : undefined;
  const knownActive = knownRoom?.status === "active";
  const knownFinished = knownRoom?.status === "finished";

  const { session, start, reconcile } = useGameSession<S, M>(
    game,
    knownRoom ? (knownRoom.state as S) : undefined,
  );

  const [phase, setPhase] = useState<WatchPhase>(
    knownFinished ? "finished" : knownActive ? "watching" : "connecting",
  );
  const [seats, setSeats] = useState<SeatsConfig>(knownRoom ? publicRoomToSeats(knownRoom) : []);
  const [moveLog, setMoveLog] = useState<AppliedMove<M>[]>([]);

  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const creatorTokenRef = useRef(creatorToken);
  creatorTokenRef.current = creatorToken;

  useEffect(() => {
    if (knownActive) {
      start();
      return;
    }
    if (knownFinished) return; // already reconciled from `initialRoom` above.

    // No usable snapshot at mount (e.g. a reload) — request one explicitly,
    // presenting the creator credential so the server also (re-)joins this
    // socket to the room's broadcast channel (docs/API_SPEC.md §3.0's
    // `room:state`) — the only way to keep receiving `game:update`/`game:over`
    // for an all-bot room, which has no seat/sessionToken to bind to.
    const socket = getSocket();
    socket.emit(
      "room:state",
      { roomId, ...(creatorTokenRef.current ? { creatorToken: creatorTokenRef.current } : {}) },
      (response: { ok: true; data: { room: PublicRoom } } | { ok: false; error: unknown }) => {
        if (!response.ok || response.data.room.roomId !== roomIdRef.current) return;
        const { room } = response.data;
        reconcile(room.state as S);
        setSeats(publicRoomToSeats(room));
        if (room.status === "active") {
          start();
          setPhase("watching");
        } else if (room.status === "finished") {
          setPhase("finished");
        }
      },
    );
    // Only meaningful once per room, from the snapshot this hook mounts with.
  }, [roomId]);

  useEffect(() => {
    const socket = getSocket();

    const handleGameStart = (payload: { room: PublicRoom }): void => {
      if (payload.room.roomId !== roomIdRef.current) return;
      reconcile(payload.room.state as S);
      setSeats(publicRoomToSeats(payload.room));
      start();
      setPhase("watching");
    };

    const handleGameUpdate = (payload: {
      room: PublicRoom;
      lastMove: { slot: Slot; move: unknown };
    }): void => {
      if (payload.room.roomId !== roomIdRef.current) return;
      const applied: AppliedMove<M> = {
        move: payload.lastMove.move as M,
        player: payload.lastMove.slot as Player,
      };
      reconcile(payload.room.state as S, applied);
      setMoveLog((log) => [...log, applied]);
    };

    const handleGameOver = (payload: { room: PublicRoom; result: Result }): void => {
      if (payload.room.roomId !== roomIdRef.current) return;
      reconcile(payload.room.state as S);
      setPhase("finished");
    };

    socket.on("game:start", handleGameStart);
    socket.on("game:update", handleGameUpdate);
    socket.on("game:over", handleGameOver);

    return () => {
      socket.off("game:start", handleGameStart);
      socket.off("game:update", handleGameUpdate);
      socket.off("game:over", handleGameOver);
    };
    // `reconcile`/`start` are stable callbacks from `useGameSession`.
  }, [roomId]);

  return {
    session,
    state: session.state,
    result: session.result,
    turn: session.turn,
    seats,
    moveLog,
    phase,
  };
}
