// MPG-010: local-play controller. Sits on top of `useGameSession` (MPG-030) and
// owns the one piece of orchestration that hook explicitly leaves out: deciding
// *when* a bot should move and pacing that so bot-vs-bot play is watchable.
//
// No game-outcome authority lives here — legality/results are entirely decided by
// the pure engine via `useGameSession`. This hook only decides *whose turn triggers
// what*: a human's turn waits for a board interaction (`play`); a bot's turn is
// computed with `pickMove` after a short, paced delay and applied the same way a
// human move would be (`applyLocalMove`), so both paths are reconciled identically.

import { useCallback, useEffect, useRef } from "react";
import type { Difficulty, GameModule, Player } from "@mpg/engine";
import { pickMove } from "@mpg/engine";
import { useGameSession } from "./useGameSession";
import type { GameSessionState } from "./gameSession";
import type { SeatsConfig } from "./seatConfig";
import { getBotThinkingDelayMs } from "./motion";

export interface LocalPlayController<S, M> {
  readonly session: GameSessionState<S, M>;
  readonly seats: SeatsConfig;
  /** Whether the seat to move is a human and awaiting a board interaction. */
  readonly isHumanTurn: boolean;
  /** The seat (1-based) currently "thinking", or `null` if no bot is computing a move. */
  readonly thinkingSeat: Player | null;
  /**
   * Submit a move as the current human player. A no-op (does nothing, no error) if
   * it isn't a human's turn — callers should also disable the relevant control via
   * `isHumanTurn`, this is a belt-and-braces guard against stale event handlers.
   */
  play: (move: M) => void;
  /** Dismiss the current move-rejection error (e.g. after a toast auto-dismisses). */
  clearError: () => void;
  /** Starts a fresh game with the same seats. */
  rematch: () => void;
}

/**
 * Drives one local game session end-to-end: applies human moves as they come in,
 * and runs bots' turns automatically (mixed difficulties supported per-seat; an
 * all-bot config free-runs to completion, paced by `--duration-bot-thinking-step`).
 */
export function useLocalPlayController<S, M>(
  game: GameModule<S, M>,
  seats: SeatsConfig,
  rng?: () => number,
): LocalPlayController<S, M> {
  const { session, start, applyLocalMove, setThinking, clearError, reset } = useGameSession(game);

  // Dedupe guard: `session.state` only changes reference when a move is actually
  // applied (start/set_thinking/clear_error swap `status` but keep the same `state`
  // object) — see gameSession.ts. Tracking "have we already scheduled a bot move for
  // this exact state" this way means the effect below can safely re-run on every
  // status flip (including the "thinking" flip it triggers itself) without ever
  // double-scheduling or, worse, cancelling its own pending timeout.
  const scheduledForRef = useRef<S | null>(null);
  const timeoutRef = useRef<number | undefined>(undefined);
  const rngRef = useRef(rng);
  rngRef.current = rng;

  // Move a freshly-created session into "playing" once, on mount.
  useEffect(() => {
    start();
  }, [start]);

  useEffect(() => {
    if (session.status.type !== "playing") return;

    const seat = seats[session.turn - 1];
    if (!seat || seat.kind !== "bot") return; // human's turn — wait for `play`

    if (scheduledForRef.current === session.state) return; // already scheduled/thinking
    scheduledForRef.current = session.state;

    const difficulty: Difficulty = seat.difficulty;
    const turnState = session.state;
    const turnPlayer = session.turn;

    setThinking(turnPlayer);

    const delay = getBotThinkingDelayMs();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = undefined;
      const move = pickMove(game, turnState, difficulty, rngRef.current);
      applyLocalMove(move);
    }, delay);
  }, [session, seats, game, setThinking, applyLocalMove]);

  // Clear any pending bot-move timer whenever the underlying game position changes
  // (a move landed) or the component unmounts — belt-and-braces against dangling
  // timers across rematch/navigation, even though the timeout above self-clears.
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }
    };
  }, [session.state]);

  // "Interactible by the human at the board" — true both while awaiting their move
  // and immediately after a rejected attempt (so a mis-click doesn't lock the board;
  // they should be able to try again right away), but not while a bot is thinking or
  // the game has ended.
  const isHumanTurn =
    (session.status.type === "playing" || session.status.type === "error") &&
    seats[session.turn - 1]?.kind === "human";

  const thinkingSeat = session.status.type === "thinking" ? session.status.player : null;

  const play = useCallback(
    (move: M) => {
      if (session.status.type === "thinking" || session.status.type === "game_over") return;
      const seat = seats[session.turn - 1];
      if (!seat || seat.kind !== "human") return;
      applyLocalMove(move);
    },
    [session.status.type, session.turn, seats, applyLocalMove],
  );

  const rematch = useCallback(() => {
    scheduledForRef.current = null;
    reset();
    start();
  }, [reset, start]);

  return { session, seats, isHumanTurn, thinkingSeat, play, clearError, rematch };
}
