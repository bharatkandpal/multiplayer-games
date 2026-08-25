// MPG-010: local-play controller. Sits on top of `useGameSession` (MPG-030) and
// owns the one piece of orchestration that hook explicitly leaves out: deciding
// *when* a bot should move and pacing that so bot-vs-bot play is watchable.
//
// No game-outcome authority lives here — legality/results are entirely decided by
// the pure engine via `useGameSession`. This hook only decides *whose turn triggers
// what*: a human's turn waits for a board interaction (`play`); a bot's turn is
// computed with `pickMove` after a short, paced delay and applied the same way a
// human move would be (`applyLocalMove`), so both paths are reconciled identically.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Difficulty, GameModule, Player } from "@mpg/engine";
import { pickMove } from "@mpg/engine";
import { useGameSession } from "./useGameSession";
import type { GameSessionState } from "./gameSession";
import type { SeatsConfig } from "./seatConfig";
import { getBotThinkingDelayMs } from "./motion";

/**
 * Bot-vs-bot watch pacing (UX_PRINCIPLES §3: paced watch WITH a way to speed up
 * or step). "1x" is the default paced delay (`--duration-bot-thinking-step`),
 * "2x" halves it, and "instant" removes it entirely (moves land back-to-back).
 * `prefers-reduced-motion` already zeroes the underlying token, so any speed
 * multiplied by that stays 0 — the kill switch is never overridden.
 */
export type WatchSpeed = "1x" | "2x" | "instant";

const WATCH_SPEED_FACTOR: Record<WatchSpeed, number> = {
  "1x": 1,
  "2x": 0.5,
  instant: 0,
};

interface PendingBotMove<S> {
  readonly state: S;
  readonly difficulty: Difficulty;
}

export interface LocalPlayController<S, M> {
  readonly session: GameSessionState<S, M>;
  readonly seats: SeatsConfig;
  /** Whether the seat to move is a human and awaiting a board interaction. */
  readonly isHumanTurn: boolean;
  /** The seat (1-based) currently "thinking", or `null` if no bot is computing a move. */
  readonly thinkingSeat: Player | null;
  /** True when every seat is a bot — the "watch" case the speed/step controls are for. */
  readonly isAllBots: boolean;
  /** Current watch-pacing multiplier. Only meaningful (and only surfaced in the UI) when `isAllBots`. */
  readonly watchSpeed: WatchSpeed;
  /** Change the watch-pacing multiplier. */
  setWatchSpeed: (speed: WatchSpeed) => void;
  /** Whether automatic bot pacing is paused (moves only land via `step`). */
  readonly isPaused: boolean;
  /** Pause/resume automatic bot pacing. Takes effect from the next scheduled move. */
  setPaused: (paused: boolean) => void;
  /** True when a bot move is queued and ready to be advanced via `step`. */
  readonly canStep: boolean;
  /** Immediately applies the currently-queued bot move (cancelling any pending delay). No-op if none is queued. */
  step: () => void;
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

  const isAllBots = seats.every((seat) => seat.kind === "bot");

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

  // Watch-mode pacing controls (bot-vs-bot only). Read via refs inside the
  // scheduling effect below so changing them doesn't need to be a dependency
  // that re-triggers scheduling for the *current* move — a speed/pause change
  // takes effect starting with the next bot move, which reads intuitively
  // ("I hit pause and the next move waits") without fighting the dedupe guard.
  const [watchSpeed, setWatchSpeed] = useState<WatchSpeed>("1x");
  const [isPaused, setPaused] = useState(false);
  const watchSpeedRef = useRef(watchSpeed);
  watchSpeedRef.current = watchSpeed;
  const pausedRef = useRef(isPaused);
  pausedRef.current = isPaused;

  // The bot move queued for the current turn, if any — set as soon as a bot's
  // turn is recognized (whether or not it's paused), so `step` can apply it
  // immediately regardless of whether an automatic timeout is also pending.
  const pendingBotRef = useRef<PendingBotMove<S> | null>(null);
  const [canStep, setCanStep] = useState(false);

  // Move a freshly-created session into "playing" once, on mount.
  useEffect(() => {
    start();
  }, [start]);

  // Start (or restart, on resume) the paced countdown for whatever bot move is
  // currently queued in `pendingBotRef`. No-op if nothing is queued or a timer is
  // already running. Reads speed via ref so a mid-countdown speed change applies to
  // the *next* move, not this one (see the ref comment above).
  const scheduleDelayedMove = useCallback(() => {
    if (!pendingBotRef.current || timeoutRef.current !== undefined) return;
    const pending = pendingBotRef.current;
    const baseDelay = getBotThinkingDelayMs();
    const delay = baseDelay * WATCH_SPEED_FACTOR[watchSpeedRef.current];
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = undefined;
      pendingBotRef.current = null;
      setCanStep(false);
      const move = pickMove(game, pending.state, pending.difficulty, rngRef.current);
      applyLocalMove(move);
    }, delay);
  }, [game, applyLocalMove]);

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
    pendingBotRef.current = { state: turnState, difficulty };
    setCanStep(true);

    if (pausedRef.current) return; // paused — wait for `step()` or resume
    scheduleDelayedMove();
  }, [session, seats, game, setThinking, scheduleDelayedMove]);

  // Pause/resume the *in-flight* countdown too (not just future moves): hitting
  // Pause halts the current timer while leaving the move queued (so Step or Resume
  // can still apply it); Resume restarts the countdown for that queued move.
  useEffect(() => {
    if (isPaused) {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }
    } else {
      scheduleDelayedMove();
    }
  }, [isPaused, scheduleDelayedMove]);

  const step = useCallback(() => {
    const pending = pendingBotRef.current;
    if (!pending) return;
    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
    pendingBotRef.current = null;
    setCanStep(false);
    const move = pickMove(game, pending.state, pending.difficulty, rngRef.current);
    applyLocalMove(move);
  }, [game, applyLocalMove]);

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

  return {
    session,
    seats,
    isHumanTurn,
    thinkingSeat,
    isAllBots,
    watchSpeed,
    setWatchSpeed,
    isPaused,
    setPaused,
    canStep,
    step,
    play,
    clearError,
    rematch,
  };
}
