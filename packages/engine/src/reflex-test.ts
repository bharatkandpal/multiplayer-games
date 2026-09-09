// Reflex Test — a solo real-time game implementing the pure RealtimeModule<S, I>
// contract (ADR 0002). The panel holds RED for a randomised wait, flips to GREEN,
// and the player taps as fast as they can. Five rounds per run; the run reports the
// best and average reaction time.
//
// Tapping while the panel is still red is a FALSE START: it ends the run immediately
// with a score of 0. Without that rule the game is trivially beaten by mashing, since
// a held-down tap would register on the very first green tick.
//
// PURE, exactly like the other realtime modules: no clock, no rAF, no Math.random.
// The wait length is drawn from the seeded PRNG carried in state (see ./prng), and
// time is counted in FIXED TICKS rather than milliseconds read off a wall clock — so
// a run is a deterministic function of (seed, input log), replayable server-side to
// validate a submitted score. The rAF loop, wall-clock pacing, input sampling and
// rendering all live in the web controller.

import { nextFloat, seedPrng, type PrngState } from "./prng";
import type { RealtimeModule } from "./realtime";

/** Per-tick input: a tap is a rising edge (true only on the tick it's requested). */
export interface ReflexInput {
  readonly tap: boolean;
}

/** Which colour the panel is showing: red = wait, green = tap now. */
export type ReflexLight = "waiting" | "go";

export interface ReflexState {
  /** Rounds completed so far, 0..ROUNDS. Doubles as the current round index. */
  readonly roundIndex: number;
  readonly light: ReflexLight;
  /** Ticks left on the red panel before it flips to green. */
  readonly waitTicks: number;
  /** Ticks since the panel turned green — this is the reaction being measured. */
  readonly reactTicks: number;
  /** Reaction time in ms for each completed round, in order. */
  readonly times: readonly number[];
  /** Set when the player tapped on red; the run is over and scores 0. */
  readonly falseStart: boolean;
  readonly over: boolean;
  readonly rng: PrngState;
}

/**
 * 200Hz — deliberately far above the 60Hz the other arcade games use. The tick rate
 * IS the measurement resolution here (a reaction can only be read to the nearest
 * tick), and 60Hz would quantise times to 16.7ms — coarse enough to blur the gap
 * between a good human reaction (~200ms) and a great one (~180ms). 200Hz gives 5ms
 * resolution, and the tick itself is a handful of integer ops, so the cost is trivial.
 */
const TICK_HZ = 200;
const MS_PER_TICK = 1000 / TICK_HZ;

export const REFLEX = {
  /** Rounds per run. The run score averages all of them. */
  rounds: 5,
  /** Red always holds at least this long, so the flip is never instant. */
  minWaitMs: 1000,
  /** ...plus a random extra up to this, so the flip can never be anticipated. */
  maxExtraWaitMs: 2000,
  /**
   * A round is force-ended at this reaction time. Without a cap, a player who walks
   * away leaves the run hanging forever; with it, ignoring a green panel simply
   * scores the worst possible round.
   */
  timeoutMs: 2000,
  /**
   * Reaction time is lower-is-better, but the platform leaderboard ranks
   * `desc(bestScore)` — so the run's average is converted into points against this
   * baseline (a 250ms average scores 750). Anything at or above the baseline scores 0.
   */
  scoreBaselineMs: 1000,
} as const;

const MIN_WAIT_TICKS = Math.round(REFLEX.minWaitMs / MS_PER_TICK);
const MAX_EXTRA_WAIT_TICKS = Math.round(REFLEX.maxExtraWaitMs / MS_PER_TICK);
const TIMEOUT_TICKS = Math.round(REFLEX.timeoutMs / MS_PER_TICK);

/** Draws the next red-hold length. Pure: returns the advanced RNG alongside it. */
function rollWait(rng: PrngState): { waitTicks: number; rng: PrngState } {
  const { value, next } = nextFloat(rng);
  return {
    waitTicks: MIN_WAIT_TICKS + Math.floor(value * MAX_EXTRA_WAIT_TICKS),
    rng: next,
  };
}

/** Fastest completed round in ms, or `null` before any round completes. */
export function bestTimeMs(state: ReflexState): number | null {
  if (state.times.length === 0) return null;
  return Math.min(...state.times);
}

/**
 * Time elapsed on the CURRENT round since the panel turned green, in ms — the
 * live reaction readout. 0 while the panel is still red. Exported so the renderer
 * never has to know the tick rate to convert ticks into milliseconds.
 */
export function currentReactionMs(state: ReflexState): number {
  return state.light === "go" ? state.reactTicks * MS_PER_TICK : 0;
}

/** Mean of completed rounds in ms, or `null` before any round completes. */
export function averageTimeMs(state: ReflexState): number | null {
  if (state.times.length === 0) return null;
  const total = state.times.reduce((sum, t) => sum + t, 0);
  return total / state.times.length;
}

export const reflexTest: RealtimeModule<ReflexState, ReflexInput> = {
  id: "reflex-test",
  kind: "realtime",
  tickHz: TICK_HZ,

  createInitialState(seed: number): ReflexState {
    const { waitTicks, rng } = rollWait(seedPrng(seed));
    return {
      roundIndex: 0,
      light: "waiting",
      waitTicks,
      reactTicks: 0,
      times: [],
      falseStart: false,
      over: false,
      rng,
    };
  },

  tick(state: ReflexState, input: ReflexInput): ReflexState {
    // Once over, the run is frozen — ticks are a no-op (times/score are final).
    if (state.over) return state;

    if (state.light === "waiting") {
      // Checked BEFORE the countdown, so a tap on the very tick the wait expires is
      // still a false start: the panel was red when that input was sampled.
      if (input.tap) return { ...state, falseStart: true, over: true };

      const waitTicks = state.waitTicks - 1;
      if (waitTicks > 0) return { ...state, waitTicks };
      // Flip to green. `reactTicks` starts at 0 and is incremented on subsequent
      // ticks, so the fastest recordable reaction is one tick (5ms).
      return { ...state, light: "go", waitTicks: 0, reactTicks: 0 };
    }

    const reactTicks = state.reactTicks + 1;
    const timedOut = reactTicks >= TIMEOUT_TICKS;
    if (!input.tap && !timedOut) return { ...state, reactTicks };

    const times = [...state.times, Math.min(reactTicks, TIMEOUT_TICKS) * MS_PER_TICK];
    const roundIndex = state.roundIndex + 1;
    if (roundIndex >= REFLEX.rounds) {
      return { ...state, times, roundIndex, reactTicks, over: true };
    }

    const { waitTicks, rng } = rollWait(state.rng);
    return { ...state, times, roundIndex, light: "waiting", waitTicks, reactTicks: 0, rng };
  },

  getScore(state: ReflexState): number {
    if (state.falseStart) return 0;
    const average = averageTimeMs(state);
    if (average === null) return 0;
    return Math.max(0, Math.round(REFLEX.scoreBaselineMs - average));
  },

  isGameOver(state: ReflexState): boolean {
    return state.over;
  },
};
