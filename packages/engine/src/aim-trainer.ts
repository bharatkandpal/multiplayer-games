// Aim Trainer (MPG-142) — a solo real-time arcade game implementing the pure
// RealtimeModule<S, I> contract (ADR 0002). Targets pop up on a grid and expire;
// hit them before they do. Miss enough — by being slow OR by hitting nothing —
// and the run is over.
//
// PURE, like every module in this family: no clock, no rAF, no Math.random.
// Target placement derives entirely from the seeded PRNG carried in state (see
// ./prng), so a run is a deterministic function of (seed, input log) — replayable
// server-side to validate a submitted score (MPG-065).
//
// The input is a normalised POSITION (`{x, y}` in 0..1 over the play surface)
// rather than a cell index, deliberately: the input source that produces it (the
// web `tap-target` source) then needs to know nothing about this game's grid, and
// a future version of the game can change its grid — or drop the grid entirely
// for free-floating targets — without touching the seam. Mapping a position onto
// the board is a rule, so it lives here.

import { nextFloat, seedPrng, type PrngState } from "./prng";
import type { RealtimeModule } from "./realtime";

/** A tap at a normalised position over the play surface; `null` on a quiet tick. */
export interface AimTrainerInput {
  readonly tap: { readonly x: number; readonly y: number } | null;
}

/** A target currently on the board. */
export interface AimTarget {
  /** Row-major cell index into the `cols × rows` grid. */
  readonly cell: number;
  /** Ticks before it expires and costs a miss. */
  readonly ticksLeft: number;
  /** Ticks it was born with — lets a renderer draw the remaining fraction. */
  readonly lifetime: number;
}

export interface AimTrainerState {
  readonly targets: readonly AimTarget[];
  /** Misses so far: expired targets AND taps that hit nothing. */
  readonly misses: number;
  /** Targets hit — drives both the score and the difficulty ramp. */
  readonly hits: number;
  /** Ticks since the last spawn. */
  readonly sinceSpawn: number;
  readonly score: number;
  readonly over: boolean;
  readonly rng: PrngState;
}

export const AIM = {
  cols: 4,
  rows: 4,
  /** Targets that may be on the board at once. */
  maxTargets: 3,
  /** Misses that end the run. */
  maxMisses: 5,
  /** Points per hit. */
  hitScore: 10,
  /** Ticks between spawns at the start of a run. */
  startSpawnTicks: 24,
  /** Fastest spawns ever get. */
  minSpawnTicks: 9,
  /** Ticks a target survives at the start of a run. */
  startLifetimeTicks: 60,
  /**
   * Shortest a target's life ever gets. A floor, not a target: below roughly
   * 0.8s a hit stops being aim and starts being luck, and a game that becomes
   * random rather than hard is just a shorter game.
   */
  minLifetimeTicks: 24,
  /** Hits per one-step tightening of both the spawn rate and the lifetime. */
  hitsPerStep: 6,
} as const;

/**
 * 30Hz. The sim resolves taps and counts down lifetimes — no physics to
 * integrate — so 33ms granularity is far finer than the mechanic needs, and it
 * halves the input log replayed server-side versus 60Hz.
 */
const TICK_HZ = 30;

/** Cells on the board. */
export const AIM_CELLS = AIM.cols * AIM.rows;

/** Ticks between spawns after `hits` hits — tightens to a floor. */
export function spawnTicksFor(hits: number): number {
  const ramped = AIM.startSpawnTicks - Math.floor(hits / AIM.hitsPerStep) * 2;
  return Math.max(AIM.minSpawnTicks, ramped);
}

/** Ticks a target lives after `hits` hits — shortens to a floor. */
export function lifetimeFor(hits: number): number {
  const ramped = AIM.startLifetimeTicks - Math.floor(hits / AIM.hitsPerStep) * 4;
  return Math.max(AIM.minLifetimeTicks, ramped);
}

/**
 * The cell a normalised tap lands in. Positions on or past an edge clamp into
 * the board rather than returning nothing: a tap at exactly `x === 1` is the
 * player hitting the right-hand column, not a rounding error, and "the tap went
 * nowhere" is not a state this game has.
 */
export function cellAt(x: number, y: number): number {
  const clamp = (v: number, max: number): number =>
    Math.max(0, Math.min(max - 1, Math.floor(v * max)));
  return clamp(y, AIM.rows) * AIM.cols + clamp(x, AIM.cols);
}

/** Misses left before the run ends — what a renderer draws as "lives". */
export function missesLeft(state: AimTrainerState): number {
  return Math.max(0, AIM.maxMisses - state.misses);
}

/** Spawns a target on a uniformly-random free cell, if there is one. Pure. */
function spawn(state: AimTrainerState): { targets: readonly AimTarget[]; rng: PrngState } {
  const taken = new Set(state.targets.map((t) => t.cell));
  const free: number[] = [];
  for (let i = 0; i < AIM_CELLS; i += 1) if (!taken.has(i)) free.push(i);
  if (free.length === 0) return { targets: state.targets, rng: state.rng };

  const pick = nextFloat(state.rng);
  const cell = free[Math.floor(pick.value * free.length)];
  if (cell === undefined) return { targets: state.targets, rng: pick.next };

  const lifetime = lifetimeFor(state.hits);
  return {
    targets: [...state.targets, { cell, ticksLeft: lifetime, lifetime }],
    rng: pick.next,
  };
}

export const aimTrainer: RealtimeModule<AimTrainerState, AimTrainerInput> = {
  id: "aim-trainer",
  kind: "realtime",
  tickHz: TICK_HZ,

  createInitialState(seed: number): AimTrainerState {
    const empty: AimTrainerState = {
      targets: [],
      misses: 0,
      hits: 0,
      sinceSpawn: 0,
      score: 0,
      over: false,
      rng: seedPrng(seed),
    };
    // Open with one target already up, so the first thing the player sees is
    // something to hit rather than an empty board and a wait.
    const first = spawn(empty);
    return { ...empty, targets: first.targets, rng: first.rng };
  },

  tick(state: AimTrainerState, input: AimTrainerInput): AimTrainerState {
    // Once over, the run is frozen — ticks are a no-op (the score is final).
    if (state.over) return state;

    // Age every target; the ones that run out cost a miss.
    let misses = state.misses;
    const aged: AimTarget[] = [];
    for (const target of state.targets) {
      const ticksLeft = target.ticksLeft - 1;
      if (ticksLeft <= 0) misses += 1;
      else aged.push({ ...target, ticksLeft });
    }

    // Resolve the tap. Hitting nothing is a miss too — otherwise the winning
    // strategy is to hammer the whole board, which is not aiming.
    let targets: AimTarget[] = aged;
    let hits = state.hits;
    let score = state.score;
    if (input.tap !== null) {
      const cell = cellAt(input.tap.x, input.tap.y);
      const index = targets.findIndex((t) => t.cell === cell);
      if (index === -1) {
        misses += 1;
      } else {
        targets = targets.filter((_, i) => i !== index);
        hits += 1;
        score += AIM.hitScore;
      }
    }

    const next: AimTrainerState = {
      ...state,
      targets,
      misses,
      hits,
      score,
      sinceSpawn: state.sinceSpawn + 1,
    };

    // The run ends the moment the miss budget is gone — checked before spawning,
    // so a dead run never grows a target nobody can hit.
    if (misses >= AIM.maxMisses) return { ...next, over: true };

    if (next.sinceSpawn >= spawnTicksFor(hits) && targets.length < AIM.maxTargets) {
      const spawned = spawn(next);
      return { ...next, targets: spawned.targets, sinceSpawn: 0, rng: spawned.rng };
    }
    return next;
  },

  getScore(state: AimTrainerState): number {
    return state.score;
  },

  isGameOver(state: AimTrainerState): boolean {
    return state.over;
  },
};
