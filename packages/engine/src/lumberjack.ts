// Lumberjack (MPG-041) — a solo real-time arcade game implementing the pure
// RealtimeModule<S, I> contract (ADR 0002). Timberman-style: you stand at one
// side of a trunk and chop. Each chop removes the log at your feet, drops the
// rest of the trunk down, and grows a new log on top. A branch at your height on
// your side kills you — and a timer drains the whole time, refilled a little by
// every chop, so hesitating kills you just as surely as a branch does.
//
// PURE, like every module in this family: no clock, no rAF, no Math.random.
// Branch generation derives entirely from the seeded PRNG carried in state (see
// ./prng), so a run is a deterministic function of (seed, input log) — replayable
// server-side to validate a submitted score (MPG-065).
//
// **The generator can never produce an unsurvivable trunk**, and that is a rule
// rather than a tuning accident: two branches on consecutive logs would trap the
// player (one side is blocked at their height, the other arrives at their height
// on the next drop, and there is no third side to stand on). So a log may only
// grow a branch when the log below it has none — see `growLog`. The invariant is
// asserted directly in the tests, because a generator that can deal an
// unwinnable hand turns a skill game into a coin flip.

import { nextFloat, seedPrng, type PrngState } from "./prng";
import type { RealtimeModule } from "./realtime";

/** Which side of the trunk something is on. */
export type Side = "left" | "right";

/** A log's branch: one side, or a clear log. */
export type Branch = Side | "none";

/**
 * Per-tick input: a chop request on one side, or `null` on the (many) ticks with
 * no input. A chop both MOVES the lumberjack to that side and swings — they are
 * one action, exactly as in the original: you cannot reposition safely without
 * committing to the cut.
 */
export interface LumberjackInput {
  readonly chop: Side | null;
}

export interface LumberjackState {
  /**
   * The visible trunk, **bottom-first**: `trunk[0]` is the log at the
   * lumberjack's own height (the one the next chop removes). Always exactly
   * `LUMBERJACK.trunkHeight` logs — a new one grows on top per chop, so the
   * player always sees the same distance ahead.
   */
  readonly trunk: readonly Branch[];
  /** Which side the lumberjack is standing on. */
  readonly side: Side;
  /** Ticks of life left on the timer. Drains every tick; every chop adds some back. */
  readonly timeLeft: number;
  /** Chops landed — the score. */
  readonly score: number;
  readonly over: boolean;
  readonly rng: PrngState;
}

export const LUMBERJACK = {
  /** Logs visible above the lumberjack at any moment. */
  trunkHeight: 8,
  /**
   * Logs at the bottom of the starting trunk guaranteed clear, so a run can
   * never open with a death the player had no chance to read.
   */
  safeStartLogs: 3,
  /** Chance a log grows a branch, when the log below it allows one at all. */
  branchChance: 0.45,
  /** Points per chop. */
  chopScore: 1,
  /** Ticks on a full timer. At `tickHz` 30 this is the time a fresh run starts with. */
  timerMaxTicks: 150,
  /** Ticks the timer is refilled by per chop (capped at `timerMaxTicks`). */
  chopRefillTicks: 18,
  /**
   * Chops per +25% to the drain rate. The second half of the difficulty curve:
   * branches get no denser (they can't — the survivability invariant caps that),
   * so the pressure that keeps climbing is the clock.
   */
  chopsPerDrainStep: 30,
} as const;

/**
 * 30Hz. The sim only needs to resolve a chop and drain a timer — there is no
 * physics integration to keep smooth, unlike Floppy Birds or Breakout at 60 — and
 * halving the rate halves the input log replayed server-side. 33ms is still well
 * under the threshold where a chop would feel late.
 */
const TICK_HZ = 30;

/** The timer's drain per tick after `score` chops — the run's rising pressure. */
export function drainPerTick(score: number): number {
  return 1 + Math.floor(score / LUMBERJACK.chopsPerDrainStep) * 0.25;
}

/**
 * Grows one new log to sit on top of `below`.
 *
 * **The survivability invariant lives here:** a log directly above a branched log
 * must be clear. Without that rule the trunk can deal `[left, right]`, which has
 * no answer — chopping left walks into the branch at your height, and chopping
 * right drops a branch onto your head. Pure: advances the RNG.
 */
function growLog(below: Branch, rng: PrngState): { branch: Branch; rng: PrngState } {
  if (below !== "none") return { branch: "none", rng };
  const roll = nextFloat(rng);
  if (roll.value >= LUMBERJACK.branchChance) return { branch: "none", rng: roll.next };
  const sideRoll = nextFloat(roll.next);
  return { branch: sideRoll.value < 0.5 ? "left" : "right", rng: sideRoll.next };
}

/** Seconds of life left, for a renderer that wants to draw a timer bar. */
export function timeLeftFraction(state: LumberjackState): number {
  return Math.max(0, Math.min(1, state.timeLeft / LUMBERJACK.timerMaxTicks));
}

/** The branch that will arrive at the lumberjack's height on the next chop. */
export function incomingBranch(state: LumberjackState): Branch {
  return state.trunk[1] ?? "none";
}

export const lumberjack: RealtimeModule<LumberjackState, LumberjackInput> = {
  id: "lumberjack",
  kind: "realtime",
  tickHz: TICK_HZ,

  createInitialState(seed: number): LumberjackState {
    let rng = seedPrng(seed);
    const trunk: Branch[] = [];
    for (let i = 0; i < LUMBERJACK.trunkHeight; i += 1) {
      if (i < LUMBERJACK.safeStartLogs) {
        trunk.push("none");
        continue;
      }
      const grown = growLog(trunk[i - 1] ?? "none", rng);
      trunk.push(grown.branch);
      rng = grown.rng;
    }
    return {
      trunk,
      side: "left",
      timeLeft: LUMBERJACK.timerMaxTicks,
      score: 0,
      over: false,
      rng,
    };
  },

  tick(state: LumberjackState, input: LumberjackInput): LumberjackState {
    // Once over, the run is frozen — ticks are a no-op (the score is final).
    if (state.over) return state;

    // The clock runs whether or not you swing. Resolved BEFORE the chop so a
    // player cannot chop on the exact tick the timer expires and survive it —
    // the timer is the one deadline that is never negotiable.
    const timeLeft = state.timeLeft - drainPerTick(state.score);
    if (timeLeft <= 0) return { ...state, timeLeft: 0, over: true };

    const side = input.chop;
    if (side === null) return { ...state, timeLeft };

    // Moving into a branch already at your height: you walked into it.
    if (state.trunk[0] === side) {
      return { ...state, side, timeLeft, over: true };
    }

    // The cut lands: drop the trunk by one and grow a replacement on top.
    const remaining = state.trunk.slice(1);
    const grown = growLog(remaining[remaining.length - 1] ?? "none", state.rng);
    const trunk = [...remaining, grown.branch];

    // ...and the log that just arrived at your height takes you with it if it
    // carries a branch on your side.
    const struck = remaining[0] === side;

    return {
      trunk,
      side,
      timeLeft: struck
        ? timeLeft
        : Math.min(LUMBERJACK.timerMaxTicks, timeLeft + LUMBERJACK.chopRefillTicks),
      score: struck ? state.score : state.score + LUMBERJACK.chopScore,
      over: struck,
      rng: grown.rng,
    };
  },

  getScore(state: LumberjackState): number {
    return state.score;
  },

  isGameOver(state: LumberjackState): boolean {
    return state.over;
  },
};
