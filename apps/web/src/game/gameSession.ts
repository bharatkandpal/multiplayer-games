// Engine-agnostic, optimistic-UI state model for a single game session.
//
// This module is pure (a reducer + plain factory/selector functions) so it can be
// unit-tested in isolation (deferred to MPG-034) and reused by both the local-play
// controller (MPG-010) and, in Phase 2, a socket-driven controller. It knows nothing
// about transports, timers, or bot pacing — see `useGameSession.ts` for the thin React
// wrapper, and the future net layer for `reconcile`/`revert` wiring.
//
// Required async states (docs/UX_PRINCIPLES.md §2) map onto `GameSessionStatus`:
//   idle       -> session created, game not started yet (e.g. still configuring seats)
//   playing    -> a move is legal and awaited from `turn`
//   thinking   -> a bot is computing its move (set by the controller, not this module)
//   game_over  -> `result.status !== "in_progress"`
//   error      -> the last local move was rejected; `state` is unchanged (nothing to
//                 revert locally), but the shape matches what a server rejection needs
//
// Optimistic-move contract:
//   `applyLocalMove` applies instantly against the pure engine, before any server
//   round-trip exists. When the socket layer lands, the *same* session is expected to
//   be reconciled from the server's authoritative broadcast via `reconcile`, or rolled
//   back via `revert` on a `move:rejected` event — see the doc comments on those actions
//   below for the exact intended call sites.

import type { GameModule, IllegalMoveReason, Player, Result } from "@mpg/engine";
import { IllegalMoveError } from "@mpg/engine";
import { describeIllegalMoveReason } from "./errorMessages";

/** A move applied to a session, paired with who made it. */
export interface AppliedMove<M> {
  readonly move: M;
  readonly player: Player;
}

/**
 * Discriminated union of the states a game session can be in. UI reads `status.type`
 * to decide what to render — never infer state from field presence/absence.
 */
export type GameSessionStatus<M> =
  | { readonly type: "idle" }
  | { readonly type: "playing" }
  | { readonly type: "thinking"; readonly player: Player }
  | { readonly type: "game_over" }
  | {
      readonly type: "error";
      /** Plain-language, display-ready copy — never a raw reason code. */
      readonly message: string;
      readonly reason?: IllegalMoveReason;
      /** The move that was rejected, if any (useful for a "try again" affordance). */
      readonly rejectedMove?: AppliedMove<M>;
    };

/** The full state of one game session, independent of which game is being played. */
export interface GameSessionState<S, M> {
  readonly game: GameModule<S, M>;
  readonly state: S;
  readonly result: Result;
  /** Whose turn it is in `state` right now. Meaningless once `result` is terminal. */
  readonly turn: Player;
  readonly lastMove: AppliedMove<M> | null;
  readonly status: GameSessionStatus<M>;
}

function statusForResult<M>(result: Result): GameSessionStatus<M> {
  return result.status === "in_progress" ? { type: "playing" } : { type: "game_over" };
}

/** Builds a fresh session for `game`, optionally starting from a given `state`. */
export function createGameSession<S, M>(
  game: GameModule<S, M>,
  state: S = game.createInitialState(),
): GameSessionState<S, M> {
  const result = game.getResult(state);
  return {
    game,
    state,
    result,
    turn: game.currentPlayer(state),
    lastMove: null,
    status: { type: "idle" },
  };
}

/** Actions understood by {@link gameSessionReducer}. */
export type GameSessionAction<S, M> =
  /** Move a freshly-created ("idle") session into "playing". A no-op once started. */
  | { readonly type: "start" }
  /**
   * Apply `move` optimistically, as the player whose turn it currently is. Validated
   * synchronously against the pure engine (`applyMove`/`getResult`/`currentPlayer`):
   * on success the board updates instantly (<100ms — no I/O in this path); on
   * `IllegalMoveError` the board is left untouched and `status` becomes `"error"`
   * with friendly copy, so the caller can show a toast without any board flicker.
   */
  | { readonly type: "apply_local_move"; readonly move: M }
  /**
   * Marks a bot as computing its move. Purely a status flag for the UI ("thinking…");
   * the actual bot search and pacing lives in the local-play controller (MPG-010),
   * not here.
   */
  | { readonly type: "set_thinking"; readonly player: Player }
  /**
   * FUTURE NET HOOK. Replaces local state with the server's authoritative broadcast
   * (e.g. on a `move:made`/`state:sync` event). Call this any time the server confirms
   * a move — including the local player's own optimistically-applied one — so the
   * session never drifts from the source of truth. Safe to call even when nothing was
   * pending locally.
   */
  | { readonly type: "reconcile"; readonly state: S; readonly lastMove?: AppliedMove<M> }
  /**
   * FUTURE NET HOOK. Rolls back an optimistic move that the server rejected (a
   * `move:rejected` event). `state` is the last known-good authoritative state (typically
   * what the session held before the optimistic move was applied). `message` should come
   * from {@link describeIllegalMoveReason} (or equivalent server copy) so the revert reads
   * as a calm explanation, never a hard error — see docs/UX_PRINCIPLES.md §3.
   */
  | {
      readonly type: "revert";
      readonly state: S;
      readonly message: string;
      readonly reason?: IllegalMoveReason;
      readonly rejectedMove?: AppliedMove<M>;
    }
  /** Dismiss the current error and fall back to the status implied by `result`. */
  | { readonly type: "clear_error" }
  /** Start a new game (rematch), resetting to `state` or a fresh initial position. */
  | { readonly type: "reset"; readonly state?: S };

export function gameSessionReducer<S, M>(
  session: GameSessionState<S, M>,
  action: GameSessionAction<S, M>,
): GameSessionState<S, M> {
  switch (action.type) {
    case "start": {
      if (session.status.type !== "idle") return session;
      return { ...session, status: statusForResult(session.result) };
    }

    case "apply_local_move": {
      const player = session.game.currentPlayer(session.state);
      try {
        const nextState = session.game.applyMove(session.state, action.move, player);
        const result = session.game.getResult(nextState);
        return {
          ...session,
          state: nextState,
          result,
          turn: session.game.currentPlayer(nextState),
          lastMove: { move: action.move, player },
          status: statusForResult(result),
        };
      } catch (err) {
        if (!(err instanceof IllegalMoveError)) throw err;
        return {
          ...session,
          status: {
            type: "error",
            message: describeIllegalMoveReason(err.reason),
            reason: err.reason,
            rejectedMove: { move: action.move, player },
          },
        };
      }
    }

    case "set_thinking": {
      return { ...session, status: { type: "thinking", player: action.player } };
    }

    case "reconcile": {
      const result = session.game.getResult(action.state);
      return {
        ...session,
        state: action.state,
        result,
        turn: session.game.currentPlayer(action.state),
        lastMove: action.lastMove ?? session.lastMove,
        status: statusForResult(result),
      };
    }

    case "revert": {
      const result = session.game.getResult(action.state);
      const status: GameSessionStatus<M> = {
        type: "error",
        message: action.message,
        ...(action.reason !== undefined ? { reason: action.reason } : {}),
        ...(action.rejectedMove !== undefined ? { rejectedMove: action.rejectedMove } : {}),
      };
      return {
        ...session,
        state: action.state,
        result,
        turn: session.game.currentPlayer(action.state),
        lastMove: null,
        status,
      };
    }

    case "clear_error": {
      if (session.status.type !== "error") return session;
      return { ...session, status: statusForResult(session.result) };
    }

    case "reset": {
      const nextState = action.state ?? session.game.createInitialState();
      const result = session.game.getResult(nextState);
      return {
        ...session,
        state: nextState,
        result,
        turn: session.game.currentPlayer(nextState),
        lastMove: null,
        status: { type: "idle" },
      };
    }

    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
