// 2048 (MPG-074) — a solo real-time puzzle implementing the pure
// RealtimeModule<S, I> contract (ADR 0002). Swipe to slide every tile in one
// direction; equal tiles that collide merge into their sum and score their sum;
// each successful move spawns a new 2 (or, rarely, a 4) on a random empty cell.
// The run ends when the board is full and no move would change it.
//
// PURE, exactly like the other realtime modules: no clock, no rAF, no
// Math.random. Tile spawns derive entirely from the seeded PRNG carried in
// state (see ./prng), so a run is a deterministic function of (seed, input log)
// — replayable server-side to validate a submitted score (MPG-065). The rAF
// loop, wall-clock pacing, input sampling and rendering all live in the web
// controller/renderer.

import { nextFloat, seedPrng, type PrngState } from "./prng";
import type { RealtimeModule } from "./realtime";

/** The four swipe directions; `null` is "no input this tick" (most ticks). */
export type SwipeDir = "up" | "down" | "left" | "right";

/** Per-tick input: a swipe is a rising edge (present only on the tick requested). */
export interface Game2048Input {
  readonly swipe: SwipeDir | null;
}

export interface Game2048State {
  /**
   * Row-major 4x4 grid of tile values; `0` is an empty cell. Values are always
   * powers of two (2, 4, 8, …). Index `r * SIZE + c`.
   */
  readonly board: readonly number[];
  readonly score: number;
  readonly over: boolean;
  readonly rng: PrngState;
}

export const GAME_2048 = {
  /** Board is SIZE x SIZE. */
  size: 4,
  /** Value of a freshly-spawned tile in the common case. */
  spawnLow: 2,
  /** ...and in the rare case (see {@link SPAWN_HIGH_CHANCE}). */
  spawnHigh: 4,
  /** Probability a spawned tile is a 4 rather than a 2 (classic 2048 is 0.1). */
  spawnHighChance: 0.1,
} as const;

const SIZE = GAME_2048.size;

/**
 * 20Hz, deliberately far below the 60Hz the arcade games use. 2048 is
 * turn-like — a swipe applies to a settled board and nothing animates in the
 * sim itself — so the tick rate only needs to feel instant to a human (50ms is
 * imperceptible), and a lower rate keeps the recorded input log (one entry per
 * tick, replayed server-side) small for a puzzle that can last minutes.
 */
const TICK_HZ = 20;

/**
 * Slides one line of four values toward its front (index 0), merging each equal
 * adjacent pair exactly once. Returns the packed line and the score gained (the
 * sum of the merged tiles). Pure.
 */
function slideLine(line: readonly number[]): { line: number[]; gained: number } {
  const tiles = line.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    const a = tiles[i];
    if (a === undefined) continue; // unreachable (i < length); satisfies the checker
    const b = tiles[i + 1];
    if (b !== undefined && a === b) {
      const merged = a * 2;
      out.push(merged);
      gained += merged;
      i += 1; // consume the partner so it can't merge again this move
    } else {
      out.push(a);
    }
  }
  while (out.length < SIZE) out.push(0);
  return { line: out, gained };
}

/** The four board indices of one line, ordered so the tiles move toward index 0. */
function lineIndices(dir: SwipeDir, i: number): number[] {
  switch (dir) {
    case "left":
      return [0, 1, 2, 3].map((c) => i * SIZE + c);
    case "right":
      return [3, 2, 1, 0].map((c) => i * SIZE + c);
    case "up":
      return [0, 1, 2, 3].map((r) => r * SIZE + i);
    case "down":
      return [3, 2, 1, 0].map((r) => r * SIZE + i);
  }
}

/**
 * Applies a swipe to the board. Returns the new board, the score gained, and
 * whether anything actually moved (an unchanged board is a no-op that must NOT
 * spawn a tile — the classic rule). Pure.
 */
export function applySwipe(
  board: readonly number[],
  dir: SwipeDir,
): { board: number[]; gained: number; moved: boolean } {
  const next = board.slice();
  let gained = 0;
  let moved = false;
  for (let i = 0; i < SIZE; i += 1) {
    const idx = lineIndices(dir, i);
    const before = idx.map((j) => board[j] ?? 0);
    const { line, gained: g } = slideLine(before);
    gained += g;
    for (let k = 0; k < SIZE; k += 1) {
      const j = idx[k];
      if (j === undefined) continue;
      const v = line[k] ?? 0;
      if (next[j] !== v) moved = true;
      next[j] = v;
    }
  }
  return { board: next, gained, moved };
}

/** Adds a tile (2, or rarely 4) to a random empty cell. Pure: advances the RNG. */
function spawnTile(board: readonly number[], rng: PrngState): { board: number[]; rng: PrngState } {
  const empties: number[] = [];
  for (let i = 0; i < board.length; i += 1) if (board[i] === 0) empties.push(i);
  if (empties.length === 0) return { board: board.slice(), rng };

  const pick = nextFloat(rng);
  const cell = empties[Math.floor(pick.value * empties.length)];
  if (cell === undefined) return { board: board.slice(), rng: pick.next };
  const roll = nextFloat(pick.next);
  const value = roll.value < GAME_2048.spawnHighChance ? GAME_2048.spawnHigh : GAME_2048.spawnLow;

  const next = board.slice();
  next[cell] = value;
  return { board: next, rng: roll.next };
}

/** Whether any swipe would change the board — the negation of "game over". */
function canMove(board: readonly number[]): boolean {
  for (let i = 0; i < board.length; i += 1) {
    const v = board[i];
    if (v === undefined) continue;
    if (v === 0) return true;
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    if (c + 1 < SIZE && board[i + 1] === v) return true;
    if (r + 1 < SIZE && board[i + SIZE] === v) return true;
  }
  return false;
}

/** The largest tile on the board — the number a player brags about. */
export function highestTile(state: Game2048State): number {
  return state.board.reduce((max, v) => (v > max ? v : max), 0);
}

export const game2048: RealtimeModule<Game2048State, Game2048Input> = {
  id: "2048",
  kind: "realtime",
  tickHz: TICK_HZ,

  createInitialState(seed: number): Game2048State {
    let board: number[] = new Array(SIZE * SIZE).fill(0);
    let rng = seedPrng(seed);
    // Two starting tiles, exactly like the original game.
    for (let n = 0; n < 2; n += 1) {
      const spawned = spawnTile(board, rng);
      board = spawned.board;
      rng = spawned.rng;
    }
    return { board, score: 0, over: false, rng };
  },

  tick(state: Game2048State, input: Game2048Input): Game2048State {
    // Once over, the run is frozen — ticks are a no-op (score is final).
    if (state.over) return state;
    // No swipe this tick, or a swipe that doesn't change the board: no move, no
    // spawn, no score (the classic rule — you can't "burn" a spawn on a wall).
    if (input.swipe === null) return state;

    const { board, gained, moved } = applySwipe(state.board, input.swipe);
    if (!moved) return state;

    const spawned = spawnTile(board, state.rng);
    const over = !canMove(spawned.board);
    return { board: spawned.board, score: state.score + gained, over, rng: spawned.rng };
  },

  getScore(state: Game2048State): number {
    return state.score;
  },

  isGameOver(state: Game2048State): boolean {
    return state.over;
  },
};
