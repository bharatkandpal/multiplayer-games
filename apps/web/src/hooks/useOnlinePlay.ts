/**
 * Online-play net-layer hook (MPG-068) — the socket-driven counterpart to
 * `useLocalPlayController` (MPG-010). Drives one game over the wire instead
 * of a local engine: applies the local player's own move optimistically
 * (`makeMove` → `applyLocalMove`, same as local play — <100ms feedback, no
 * I/O in that path), then reconciles to the server's authoritative broadcast
 * (`game:update`/`game:over` → `reconcile`) or rolls back smoothly with a
 * plain-language explanation (`move:rejected` → `revert`).
 *
 * This is the ONE reusable net-layer helper `gameSession.ts` was written to
 * expect (see its "FUTURE NET HOOK" doc comments on `reconcile`/`revert`) —
 * all optimistic-apply/reconcile/revert logic lives in `useGameSession`
 * itself; this hook only wires socket events to those three calls plus the
 * turn-taking/connection-status bookkeeping that's specific to being online.
 *
 * No game-outcome authority lives here: legality/results are entirely decided
 * server-side (`docs/API_SPEC.md` §3.1–3.2); this hook only reflects the
 * server's broadcasts (and one instant local guess, always overwritten by the
 * next `game:update`).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameModule, Player, Result } from "@mpg/engine";

import { getSocket } from "../api/socket.js";
import type { PublicRoom, Slot } from "../api/roomTypes.js";
import { describeIllegalMoveReason } from "../game/errorMessages";
import { useGameSession } from "../game/useGameSession";
import type { AppliedMove, GameSessionState } from "../game/gameSession";

export type OnlinePlayPhase = "waiting" | "playing" | "finished";

export interface UseOnlinePlayOptions<S, M, L = unknown> {
  game: GameModule<S, M, L>;
  roomId: string;
  /** This client's own seat, once known (from `useRoom()`). */
  yourSlot: Slot | undefined;
  /**
   * Optional room snapshot already known at mount (typically `useRoom()`'s
   * `room`, straight from the `room:updated` broadcast that flipped this
   * room to `active` and triggered navigation here) — lets play start
   * immediately instead of racing the separate `game:start` broadcast that
   * fires from the very same server-side transition. `game:start` is still
   * listened for below (the only source of truth for a rematch's fresh
   * room, which has no such prior snapshot).
   */
  initialRoom?: PublicRoom | undefined;
}

export interface UseOnlinePlayResult<S, M> {
  /** The full session — same shape local play uses, so both drive the same view. */
  session: GameSessionState<S, M>;
  /** Convenience alias for `session.state`. */
  state: S;
  /** Convenience alias for `session.result`. */
  result: Result;
  /** Whose turn it is, server-authoritative (mirrors `session.turn`). */
  turn: Player;
  /** True while it's this client's own seat's turn and the game is live. */
  yourTurn: boolean;
  /** Every move applied this game, oldest first (slot + move). */
  moveLog: AppliedMove<M>[];
  /** Plain-language copy for the last `move:rejected`, if any (mirrors `session.status`). */
  error: string | undefined;
  /** Send a move as this client's own seat. No-op (not an error) if it isn't your turn. */
  makeMove: (move: M) => void;
  /** Dismiss the current error banner. */
  clearError: () => void;
  phase: OnlinePlayPhase;
  /** True between `opponent:disconnected` and `opponent:reconnected`/game-over. */
  opponentDisconnected: boolean;
  /** True once `room:abandoned` fires — the opponent isn't coming back. */
  roomAbandoned: boolean;
  /** `{ reason }` from `room:abandoned`, for display copy. */
  roomAbandonReason: string | undefined;
}

/** Maps the server's `move:rejected` reason codes onto the shared, lower-case
 * `IllegalMoveReason` copy table — the two were designed to line up 1:1 (see
 * `errorMessages.ts`'s doc comment). Unknown codes fall back to the generic
 * "illegal move" copy rather than a raw code leaking into the UI. */
function describeRejection(reason: string): string {
  switch (reason) {
    case "NOT_YOUR_TURN":
      return describeIllegalMoveReason("not_your_turn");
    case "GAME_OVER":
      return describeIllegalMoveReason("game_over");
    case "ILLEGAL_MOVE":
    default:
      return describeIllegalMoveReason("illegal_move");
  }
}

/**
 * Drives one online game session end-to-end over the singleton socket
 * (`../api/socket.ts`). One instance per room — remount (fresh `roomId`) for
 * a rematch's freshly-created room.
 */
export function useOnlinePlay<S, M, L = unknown>({
  game,
  roomId,
  yourSlot,
  initialRoom,
}: UseOnlinePlayOptions<S, M, L>): UseOnlinePlayResult<S, M> {
  const knownActive = initialRoom?.status === "active" && initialRoom.roomId === roomId;

  const { session, start, applyLocalMove, reconcile, revert, clearError } = useGameSession<S, M>(
    game,
    knownActive ? (initialRoom?.state as S) : undefined,
  );

  const [phase, setPhase] = useState<OnlinePlayPhase>(knownActive ? "playing" : "waiting");
  const [moveLog, setMoveLog] = useState<AppliedMove<M>[]>([]);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [roomAbandoned, setRoomAbandoned] = useState(false);
  const [roomAbandonReason, setRoomAbandonReason] = useState<string | undefined>(undefined);

  // Last known-good (server-authoritative) state — what `revert` rolls an
  // optimistic move back to. Kept in a ref (not state) so `handleMoveRejected`
  // below always reads the latest value without needing to be re-subscribed.
  const authoritativeStateRef = useRef<S | undefined>(
    knownActive ? (initialRoom?.state as S) : undefined,
  );
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const yourSlotRef = useRef(yourSlot);
  yourSlotRef.current = yourSlot;
  const sessionTurnRef = useRef(session.turn);
  sessionTurnRef.current = session.turn;

  useEffect(() => {
    if (knownActive) {
      start();
      return;
    }
    // No snapshot at mount (e.g. a fresh rematch room, which has no prior
    // `useRoom()` state) — request one explicitly rather than only waiting
    // on a live `game:start`/`room:updated` broadcast. The server may well
    // have already fired that broadcast (e.g. a rematch room starts already
    // `active`, both seats carried over) before this hook subscribed to it —
    // that one-time broadcast is gone by the time we're listening, and
    // without this request the client hangs on "Connecting…" forever
    // (found via MPG-017's e2e rematch step). `room:state`'s ack is the
    // same snapshot shape `game:start` delivers, so it's handled identically.
    const socket = getSocket();
    socket.emit(
      "room:state",
      { roomId },
      (response: { ok: true; data: { room: PublicRoom } } | { ok: false; error: unknown }) => {
        if (!response.ok || response.data.room.roomId !== roomIdRef.current) return;
        const { room } = response.data;
        authoritativeStateRef.current = room.state as S;
        if (room.status === "active") {
          reconcile(room.state as S);
          start();
          setPhase("playing");
        } else if (room.status === "finished") {
          reconcile(room.state as S);
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
      authoritativeStateRef.current = payload.room.state as S;
      reconcile(payload.room.state as S);
      start();
      setPhase("playing");
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
      authoritativeStateRef.current = payload.room.state as S;
      reconcile(payload.room.state as S, applied);
      setMoveLog((log) => [...log, applied]);
    };

    const handleGameOver = (payload: { room: PublicRoom; result: Result }): void => {
      if (payload.room.roomId !== roomIdRef.current) return;
      authoritativeStateRef.current = payload.room.state as S;
      reconcile(payload.room.state as S);
      setPhase("finished");
    };

    const handleMoveRejected = (payload: { reason: string }): void => {
      if (authoritativeStateRef.current === undefined) return;
      revert(authoritativeStateRef.current, describeRejection(payload.reason));
    };

    const handleOpponentDisconnected = (): void => setOpponentDisconnected(true);
    const handleOpponentReconnected = (): void => setOpponentDisconnected(false);
    const handleRoomAbandoned = (payload: { reason: string }): void => {
      setRoomAbandoned(true);
      setRoomAbandonReason(payload.reason);
      setOpponentDisconnected(false);
    };

    socket.on("game:start", handleGameStart);
    socket.on("game:update", handleGameUpdate);
    socket.on("game:over", handleGameOver);
    socket.on("move:rejected", handleMoveRejected);
    socket.on("opponent:disconnected", handleOpponentDisconnected);
    socket.on("opponent:reconnected", handleOpponentReconnected);
    socket.on("room:abandoned", handleRoomAbandoned);

    return () => {
      socket.off("game:start", handleGameStart);
      socket.off("game:update", handleGameUpdate);
      socket.off("game:over", handleGameOver);
      socket.off("move:rejected", handleMoveRejected);
      socket.off("opponent:disconnected", handleOpponentDisconnected);
      socket.off("opponent:reconnected", handleOpponentReconnected);
      socket.off("room:abandoned", handleRoomAbandoned);
    };
    // `reconcile`/`revert`/`start` are stable callbacks from `useGameSession`.
  }, [roomId]);

  const yourTurn =
    phase === "playing" &&
    yourSlot !== undefined &&
    session.turn === (yourSlot as unknown as Player);

  const makeMove = useCallback(
    (move: M) => {
      if (phase !== "playing") return;
      if (yourSlotRef.current === undefined) return;
      if (sessionTurnRef.current !== (yourSlotRef.current as unknown as Player)) return;
      applyLocalMove(move);
      const socket = getSocket();
      socket.emit("move", { roomId: roomIdRef.current, move });
    },
    [phase, applyLocalMove],
  );

  return {
    session,
    state: session.state,
    result: session.result,
    turn: session.turn,
    yourTurn,
    moveLog,
    error: session.status.type === "error" ? session.status.message : undefined,
    makeMove,
    clearError,
    phase,
    opponentDisconnected,
    roomAbandoned,
    roomAbandonReason,
  };
}
