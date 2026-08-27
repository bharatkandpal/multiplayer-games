// Floppy Birds (MPG-040) — a solo real-time arcade game implementing the pure
// RealtimeModule<S, I> contract (ADR 0002). Tap-to-flap against gravity; thread the
// bird through gaps in scrolling pipes; score one per pipe passed; a collision with a
// pipe, the ceiling, or the ground ends the run.
//
// PURE, exactly like the turn-based GameModules: no clock, no rAF, no Math.random. All
// randomness (pipe gap positions) derives from the seed and is carried in state via the
// PRNG (see ./prng). The rAF loop, wall-clock pacing, input sampling and rendering all
// live in the web controller/renderer (MPG-040c/e). Given a seed + a per-tick input
// sequence, a run is fully deterministic and replayable — unit-testable with no fakes.

import { nextFloat, seedPrng, type PrngState } from "./prng";
import type { RealtimeModule } from "./realtime";

/** Per-tick input: a flap is a rising edge (true only on the tick it's requested). */
export interface FloppyInput {
  readonly flap: boolean;
}

export interface Pipe {
  /** Leading-edge x position in world units; decreases each tick as pipes scroll left. */
  readonly x: number;
  /** Vertical center of the passable gap. */
  readonly gapY: number;
  /** Whether the bird has already passed (and scored) this pipe. */
  readonly scored: boolean;
}

export interface FloppyState {
  readonly birdY: number;
  readonly birdV: number;
  readonly pipes: readonly Pipe[];
  readonly score: number;
  readonly over: boolean;
  readonly rng: PrngState;
  /** Ticks since start — drives pipe spawn cadence deterministically (no wall clock). */
  readonly t: number;
}

/**
 * World constants in abstract "world units" (the renderer maps these to canvas pixels,
 * MPG-040e). Tuned in the MPG-039 spike; reproduced here to spec.
 */
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

/** Spawns a pipe at the right edge with a randomly-placed gap. Pure: advances the RNG. */
function spawnPipe(rng: PrngState): { pipe: Pipe; rng: PrngState } {
  const { value, next } = nextFloat(rng);
  const margin = WORLD.pipeGap / 2 + 6;
  const gapY = margin + value * (WORLD.height - margin * 2);
  return { pipe: { x: WORLD.width + WORLD.pipeWidth, gapY, scored: false }, rng: next };
}

export const floppyBirds: RealtimeModule<FloppyState, FloppyInput> = {
  id: "floppy-birds",
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
    // Once over, the run is frozen — ticks are a no-op (score is final).
    if (state.over) return state;

    const t = state.t + 1;
    // A flap replaces the current velocity with the (upward) impulse; gravity then
    // applies this tick either way.
    const birdV = (input.flap ? WORLD.flapImpulse : state.birdV) + WORLD.gravity;
    const birdY = state.birdY + birdV;

    // Scroll pipes left; score the tick the bird's x passes a pipe's trailing edge;
    // drop pipes once fully off the left edge.
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

    // Collision: ground/ceiling, or a pipe body outside its gap.
    let over = birdY - WORLD.birdRadius < 0 || birdY + WORLD.birdRadius > WORLD.height;
    for (const p of pipes) {
      const withinX =
        WORLD.birdX + WORLD.birdRadius > p.x &&
        WORLD.birdX - WORLD.birdRadius < p.x + WORLD.pipeWidth;
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
