// Thin React wrapper around the pure `gameSessionReducer`. Keeps all game-outcome
// logic in the reducer (testable, transport-agnostic) and exposes a small, stable
// callback surface for controllers (MPG-010's local-play controller today; a
// socket-driven controller in Phase 2).

import { useCallback, useMemo, useReducer } from "react";
import type { GameModule, IllegalMoveReason, Player } from "@mpg/engine";
import {
  type AppliedMove,
  type GameSessionState,
  createGameSession,
  gameSessionReducer,
} from "./gameSession";

export interface UseGameSessionResult<S, M> {
  /** The full session state — read `session.status.type` to drive UI states. */
  session: GameSessionState<S, M>;

  /** Move a freshly-created session from "idle" into "playing". */
  start: () => void;

  /**
   * Apply `move` for whoever's turn it is, optimistically. Call this straight from
   * the input handler (cell click / keypress) — no `await`, so the board updates in
   * the same tick. If the move is illegal, `session.status` becomes `"error"` and the
   * board is left exactly as it was (nothing to visually revert).
   */
  applyLocalMove: (move: M) => void;

  /** Flag that `player` (a bot) is computing its move. Purely a status flag. */
  setThinking: (player: Player) => void;

  /**
   * FUTURE NET HOOK: call when the server confirms authoritative state (including
   * echoing back the local player's own move). See `gameSession.ts` for the full
   * contract this is expected to satisfy once the socket layer exists. `moveLog`
   * wholesale-replaces `session.moveLog` when given — see `gameSession.ts`.
   */
  reconcile: (state: S, lastMove?: AppliedMove<M>, moveLog?: readonly AppliedMove<M>[]) => void;

  /**
   * Peer-to-peer online play only: applies a move that arrived from the other
   * peer, asserting `player` from the wire message. See `gameSession.ts`'s
   * `apply_remote_move` for the exact anti-cheat contract.
   */
  applyRemoteMove: (move: M, player: Player) => void;

  /**
   * FUTURE NET HOOK: call on a `move:rejected` event to roll back an optimistic move.
   * `state` should be the last authoritative state; `message` is display-ready copy
   * (e.g. via `describeIllegalMoveReason`).
   */
  revert: (
    state: S,
    message: string,
    reason?: IllegalMoveReason,
    rejectedMove?: AppliedMove<M>,
  ) => void;

  /** Dismiss the current error, returning to "playing" or "game_over" as appropriate. */
  clearError: () => void;

  /** Start a rematch: resets to a fresh (or given) state and "idle" status. */
  reset: (state?: S) => void;
}

/**
 * Owns one game session's state. Engine-agnostic: pass any `GameModule` and this
 * hook applies moves, tracks turn/result, and exposes the async states required by
 * docs/UX_PRINCIPLES.md §2 (idle/playing/thinking/game_over/error) via `session.status`.
 *
 * Does NOT run a bot turn loop or pace bot-vs-bot play — that orchestration belongs
 * to the controller (MPG-010), which should call `setThinking` before computing a
 * bot move and `applyLocalMove` once it has one.
 */
export function useGameSession<S, M>(
  game: GameModule<S, M>,
  initialState?: S,
): UseGameSessionResult<S, M> {
  const [session, dispatch] = useReducer(gameSessionReducer<S, M>, undefined, () =>
    createGameSession(game, initialState),
  );

  const start = useCallback(() => dispatch({ type: "start" }), []);

  const applyLocalMove = useCallback((move: M) => dispatch({ type: "apply_local_move", move }), []);

  const setThinking = useCallback(
    (player: Player) => dispatch({ type: "set_thinking", player }),
    [],
  );

  const reconcile = useCallback(
    (state: S, lastMove?: AppliedMove<M>, moveLog?: readonly AppliedMove<M>[]) =>
      dispatch({
        type: "reconcile",
        state,
        ...(lastMove !== undefined ? { lastMove } : {}),
        ...(moveLog !== undefined ? { moveLog } : {}),
      }),
    [],
  );

  const applyRemoteMove = useCallback(
    (move: M, player: Player) => dispatch({ type: "apply_remote_move", move, player }),
    [],
  );

  const revert = useCallback(
    (state: S, message: string, reason?: IllegalMoveReason, rejectedMove?: AppliedMove<M>) =>
      dispatch({
        type: "revert",
        state,
        message,
        ...(reason !== undefined ? { reason } : {}),
        ...(rejectedMove !== undefined ? { rejectedMove } : {}),
      }),
    [],
  );

  const clearError = useCallback(() => dispatch({ type: "clear_error" }), []);

  const reset = useCallback(
    (state?: S) => dispatch({ type: "reset", ...(state !== undefined ? { state } : {}) }),
    [],
  );

  return useMemo(
    () => ({
      session,
      start,
      applyLocalMove,
      applyRemoteMove,
      setThinking,
      reconcile,
      revert,
      clearError,
      reset,
    }),
    [
      session,
      start,
      applyLocalMove,
      applyRemoteMove,
      setThinking,
      reconcile,
      revert,
      clearError,
      reset,
    ],
  );
}
