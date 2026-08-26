// THROWAWAY SPIKE (MPG-039) — not shipped. See docs/adr/0002-realtime-games.md.
//
// A prototype `RealtimeModule<S, I>` implementation used to de-risk the ADR's
// proposed abstraction. It mirrors what the shared engine (packages/engine) would
// export for realtime games: PURE, no I/O, no clock, no Math.random. The rAF loop,
// wall-clock, DOM input sampling, and rendering all live OUTSIDE this module (in
// FloppySpike.tsx) — exactly the client/engine split the turn-based side already has.
//
// NOTE: the interface below is sketched here (throwaway) rather than in
// packages/engine on purpose — landing it in the engine is the actual MPG-040 work,
// gated on ADR sign-off. This file only proves the shape is implementable & testable.

import { nextFloat, seedPrng, type PrngState } from "./prng";

// ── Proposed sibling interface (sketch; real home is packages/engine on adoption) ──

/** Per-tick input sampled by the controller. Discrete edge or continuous — module-defined. */
export interface RealtimeModule<S, I> {
  readonly id: string;
  readonly kind: "realtime";
  /** Fixed simulation rate. The controller steps the sim at exactly this Hz (see FloppySpike). */
  readonly tickHz: number;
  /** Fresh state from a seed. All randomness is derived from `seed` and carried in S. */
  createInitialState(seed: number): S;
  /** Advance the sim by exactly one fixed tick. PURE: (state, input) → state. */
  tick(state: S, input: I): S;
  /** Current run score. */
  getScore(state: S): number;
  /** Whether the run has ended (score is final). */
  isGameOver(state: S): boolean;
}

// ── Floppy Birds toy ──

export interface FloppyInput {
  /** True only on the tick a flap was requested (rising edge). */
  readonly flap: boolean;
}

export interface Pipe {
  readonly x: number;
  /** Vertical center of the gap. */
  readonly gapY: number;
  /** Whether the bird has already passed this pipe (for scoring). */
  readonly scored: boolean;
}

export interface FloppyState {
  readonly birdY: number;
  readonly birdV: number;
  readonly pipes: readonly Pipe[];
  readonly score: number;
  readonly over: boolean;
  readonly rng: PrngState;
  /** Ticks since spawn — drives pipe cadence deterministically (no wall clock). */
  readonly t: number;
}

// World constants in "world units"; the renderer maps these to canvas pixels.
export const WORLD = {
  width: 100,
  height: 100,
  gravity: 0.12, // per tick^2
  flapImpulse: -1.9,
  pipeSpeed: 0.6, // per tick
  pipeGap: 30,
  pipeSpacingTicks: 90,
  birdX: 25,
  birdRadius: 2.5,
  pipeWidth: 10,
} as const;

const TICK_HZ = 60;

function spawnPipe(rng: PrngState): { pipe: Pipe; rng: PrngState } {
  const { value, next } = nextFloat(rng);
  const margin = WORLD.pipeGap / 2 + 6;
  const gapY = margin + value * (WORLD.height - margin * 2);
  return { pipe: { x: WORLD.width + WORLD.pipeWidth, gapY, scored: false }, rng: next };
}

export const floppyBirds: RealtimeModule<FloppyState, FloppyInput> = {
  id: "floppy-birds-spike",
  kind: "realtime",
  tickHz: TICK_HZ,

  createInitialState(seed: number): FloppyState {
    const rng0 = seedPrng(seed);
    const { pipe, rng } = spawnPipe(rng0);
    return {
      birdY: WORLD.height / 2,
      birdV: 0,
      pipes: [pipe],
      score: 0,
      over: false,
      rng,
      t: 0,
    };
  },

  tick(state: FloppyState, input: FloppyInput): FloppyState {
    if (state.over) return state;

    const t = state.t + 1;
    const birdV = (input.flap ? WORLD.flapImpulse : state.birdV) + WORLD.gravity;
    const birdY = state.birdY + birdV;

    // Advance pipes; score when the bird's x passes a pipe's trailing edge.
    let score = state.score;
    const moved: Pipe[] = [];
    for (const p of state.pipes) {
      const x = p.x - WORLD.pipeSpeed;
      let scored = p.scored;
      if (!scored && x + WORLD.pipeWidth < WORLD.birdX) {
        scored = true;
        score += 1;
      }
      if (x + WORLD.pipeWidth > -1) moved.push({ x, gapY: p.gapY, scored });
    }

    // Deterministic spawn cadence (tick-counted, not time-based).
    let rng = state.rng;
    let pipes = moved;
    if (t % WORLD.pipeSpacingTicks === 0) {
      const spawned = spawnPipe(rng);
      rng = spawned.rng;
      pipes = [...moved, spawned.pipe];
    }

    // Collision: ground/ceiling, or hitting a pipe body outside the gap.
    let over = birdY - WORLD.birdRadius < 0 || birdY + WORLD.birdRadius > WORLD.height;
    for (const p of pipes) {
      const withinX =
        WORLD.birdX + WORLD.birdRadius > p.x && WORLD.birdX - WORLD.birdRadius < p.x + WORLD.pipeWidth;
      if (!withinX) continue;
      const gapTop = p.gapY - WORLD.pipeGap / 2;
      const gapBottom = p.gapY + WORLD.pipeGap / 2;
      if (birdY - WORLD.birdRadius < gapTop || birdY + WORLD.birdRadius > gapBottom) {
        over = true;
      }
    }

    return { birdY, birdV, pipes, score, over, rng, t };
  },

  getScore(state: FloppyState): number {
    return state.score;
  },

  isGameOver(state: FloppyState): boolean {
    return state.over;
  },
};
