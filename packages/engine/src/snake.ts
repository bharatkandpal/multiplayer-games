// Snake (MPG-140) — a solo real-time arcade game implementing the pure
// RealtimeModule<S, I> contract (ADR 0002). The snake moves on its own; you
// only ever steer. Eat the food to grow and score; hit a wall or your own body
// and the run is over.
//
// PURE, like every module in this family: no clock, no rAF, no Math.random.
// Food placement derives entirely from the seeded PRNG carried in state (see
// ./prng), so a run is a deterministic function of (seed, input log) — replayable
// server-side to validate a submitted score (MPG-065). Wall-clock pacing, input
// sampling and rendering all live in the web controller/renderer.
//
// Two design points worth stating, because both are places snake implementations
// classically go wrong:
//
//   1. *The sim tick is not the snake's step.* The module ticks at a fixed
//      TICK_HZ and moves the snake once every `stepTicks(...)` ticks. Steering is
//      therefore sampled far more often than the snake moves, which is what makes
//      a turn feel responsive at low speeds, and it lets the speed ramp with
//      length without touching the tick rate the input log is recorded at.
//   2. *A reversal is rejected, never fatal.* Pressing "left" while travelling
//      right is a no-op — not an instant self-collision. And a queued turn is
//      always validated against the direction last actually TRAVELLED, never
//      against another queued turn, so two quick turns inside one step can't
//      compose into a 180° and kill you (the classic bug).

import { nextFloat, seedPrng, type PrngState } from "./prng";
import type { RealtimeModule } from "./realtime";

/**
 * The four directions of travel.
 *
 * Deliberately NOT 2048's `SwipeDir`, despite the identical members: these are
 * headings the snake travels, not gestures applied to a board, and coupling the
 * two would mean a change to 2048's input vocabulary silently reshaped Snake.
 * The web layer maps its swipe/key actions onto this union at the seam.
 */
export type SnakeDir = "up" | "down" | "left" | "right";

/** Per-tick input: a steer request, or `null` on the (many) ticks with no input. */
export interface SnakeInput {
  readonly turn: SnakeDir | null;
}

export interface SnakeState {
  /**
   * The snake's occupied cells, **head first**, as row-major indices into a
   * `SNAKE.size × SNAKE.size` grid (index `r * size + c`). Always at least one
   * cell; `snake[0]` is the head.
   */
  readonly snake: readonly number[];
  /** The direction the snake last actually travelled — what a turn is validated against. */
  readonly dir: SnakeDir;
  /**
   * A steer accepted but not yet applied, consumed by the next step. Holding the
   * turn until the step (rather than rotating immediately) is what keeps the
   * snake on the grid: direction only ever changes at a cell boundary.
   */
  readonly pendingDir: SnakeDir | null;
  /** Cell index of the food, or `null` when the board is completely full. */
  readonly food: number | null;
  /** Segments still owed from food already eaten — growth is paid one step at a time. */
  readonly grow: number;
  /** Ticks elapsed since the last step; the snake moves when this reaches `stepTicks`. */
  readonly sinceStep: number;
  readonly score: number;
  readonly over: boolean;
  readonly rng: PrngState;
}

export const SNAKE = {
  /** Grid dimension — a square `size × size` board. */
  size: 12,
  /** Cells the snake starts with. */
  startLength: 3,
  /** Points per food eaten. */
  foodScore: 10,
  /** Segments gained per food eaten. */
  growPerFood: 1,
  /** Ticks between steps at the start of a run (slowest the snake ever moves). */
  startStepTicks: 5,
  /**
   * Fastest the snake ever moves. A floor, not a limit to be reached and then
   * pushed through: past ~10 steps/second a human cannot place a turn on the
   * right cell, and a game that becomes unplayable rather than hard is just a
   * shorter game.
   */
  minStepTicks: 2,
  /** Foods eaten per one-tick reduction in the step interval. */
  foodsPerSpeedUp: 4,
} as const;

/**
 * 20Hz. Like 2048, Snake does not need 60Hz: the sim advances in discrete cell
 * steps and nothing moves between them, so the tick rate only has to make a
 * steer feel instant (50ms is imperceptible) and divide the step intervals
 * evenly. A lower rate also keeps the recorded input log — one entry per tick,
 * replayed server-side — small for a run that can last minutes.
 */
const TICK_HZ = 20;

/** The two headings that are 180° from each other. */
function isReversal(a: SnakeDir, b: SnakeDir): boolean {
  return (
    (a === "up" && b === "down") ||
    (a === "down" && b === "up") ||
    (a === "left" && b === "right") ||
    (a === "right" && b === "left")
  );
}

/**
 * Ticks between steps for a snake that has eaten `eaten` foods — the difficulty
 * curve. Ramps down from `startStepTicks` to the `minStepTicks` floor, so a long
 * run gets faster but stays steerable.
 */
export function stepTicks(eaten: number): number {
  const ramped = SNAKE.startStepTicks - Math.floor(eaten / SNAKE.foodsPerSpeedUp);
  return Math.max(SNAKE.minStepTicks, ramped);
}

/**
 * The cell one step from `cell` in `dir`, or `null` if that leaves the board.
 * Walls kill — there is no wrap-around, which is what makes the board's edges
 * part of the puzzle rather than scenery.
 */
function step(cell: number, dir: SnakeDir, size: number): number | null {
  const r = Math.floor(cell / size);
  const c = cell % size;
  const nr = dir === "up" ? r - 1 : dir === "down" ? r + 1 : r;
  const nc = dir === "left" ? c - 1 : dir === "right" ? c + 1 : c;
  if (nr < 0 || nr >= size || nc < 0 || nc >= size) return null;
  return nr * size + nc;
}

/**
 * Places food on a uniformly-random free cell. Returns `null` for the food when
 * the snake fills the board — which is the run's natural end, not an error:
 * `tick` reads it and ends the run rather than searching an empty set forever.
 * Pure: advances the RNG.
 */
function placeFood(
  occupied: readonly number[],
  size: number,
  rng: PrngState,
): { food: number | null; rng: PrngState } {
  const taken = new Set(occupied);
  const free: number[] = [];
  for (let i = 0; i < size * size; i += 1) if (!taken.has(i)) free.push(i);
  if (free.length === 0) return { food: null, rng };

  const pick = nextFloat(rng);
  const cell = free[Math.floor(pick.value * free.length)];
  return { food: cell ?? null, rng: pick.next };
}

/** Number of foods eaten so far — the value the speed ramp reads. */
export function foodsEaten(state: SnakeState): number {
  return Math.floor(state.score / SNAKE.foodScore);
}

/** The snake's current length in cells — what a player brags about. */
export function snakeLength(state: SnakeState): number {
  return state.snake.length;
}

/**
 * Advances the snake by exactly one cell. Split out of `tick` because this is
 * where every rule that can end a run lives, and it is far easier to test (and
 * to read) as one function than as a branch inside the tick accounting.
 */
function advance(state: SnakeState): SnakeState {
  const size = SNAKE.size;
  // The pending turn was already validated when it was accepted; applying it
  // here (not on input) is what keeps direction changes on cell boundaries.
  const dir = state.pendingDir ?? state.dir;
  const head = state.snake[0];
  if (head === undefined) return { ...state, over: true }; // unreachable: snake is never empty

  const next = step(head, dir, size);
  if (next === null) return { ...state, dir, pendingDir: null, over: true }; // hit a wall

  // The tail cell vacates on this same step, so moving into it is legal — unless
  // growth is owed, in which case the tail stays put and it is a real collision.
  const body = state.grow > 0 ? state.snake : state.snake.slice(0, -1);
  if (body.includes(next)) return { ...state, dir, pendingDir: null, over: true };

  const ate = state.food !== null && next === state.food;
  const grow = state.grow + (ate ? SNAKE.growPerFood : 0);
  // Push the head; pay down one segment of growth, or drop the tail.
  const snake = grow > 0 ? [next, ...state.snake] : [next, ...state.snake.slice(0, -1)];

  const placed = ate ? placeFood(snake, size, state.rng) : { food: state.food, rng: state.rng };

  return {
    snake,
    dir,
    pendingDir: null,
    food: placed.food,
    grow: grow > 0 ? grow - 1 : 0,
    sinceStep: 0,
    score: state.score + (ate ? SNAKE.foodScore : 0),
    // A board with no free cell left is a completed board: the run ends here
    // rather than continuing with nothing to eat.
    over: placed.food === null,
    rng: placed.rng,
  };
}

/**
 * Snake. One registered module — unlike 2048 there are no size variants today,
 * and adding one later would follow the same "separate id, separate
 * leaderboard" rule (ADR 0007 §5) rather than mixing boards on one board.
 */
export const snake: RealtimeModule<SnakeState, SnakeInput> = {
  id: "snake",
  kind: "realtime",
  tickHz: TICK_HZ,

  createInitialState(seed: number): SnakeState {
    const size = SNAKE.size;
    // Centre row, heading right, with the body trailing off to the left. Laid
    // out from the head so `snake[0]` is the head from tick zero.
    const row = Math.floor(size / 2);
    const headCol = Math.floor(size / 2);
    const cells = Array.from(
      { length: SNAKE.startLength },
      (_, i) => row * size + (headCol - i),
    ).filter((cell) => Math.floor(cell / size) === row);

    const placed = placeFood(cells, size, seedPrng(seed));
    return {
      snake: cells,
      dir: "right",
      pendingDir: null,
      food: placed.food,
      grow: 0,
      sinceStep: 0,
      score: 0,
      over: false,
      rng: placed.rng,
    };
  },

  tick(state: SnakeState, input: SnakeInput): SnakeState {
    // Once over, the run is frozen — ticks are a no-op (the score is final).
    if (state.over) return state;

    // Accept the steer first, so a turn requested on the same tick as a step
    // still applies to that step — the difference between a snake that obeys
    // and one that feels a frame late.
    //
    // Validated against `dir` (last travelled), never against `pendingDir`: that
    // is what stops two fast turns from composing into a fatal 180°. An illegal
    // turn is simply dropped; the previously-queued one survives it.
    const requested = input.turn;
    const pendingDir =
      requested !== null && !isReversal(state.dir, requested) && requested !== state.dir
        ? requested
        : state.pendingDir;

    const sinceStep = state.sinceStep + 1;
    if (sinceStep < stepTicks(foodsEaten(state))) {
      return { ...state, pendingDir, sinceStep };
    }
    return advance({ ...state, pendingDir, sinceStep });
  },

  getScore(state: SnakeState): number {
    return state.score;
  },

  isGameOver(state: SnakeState): boolean {
    return state.over;
  },
};
