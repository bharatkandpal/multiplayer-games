// 2048 (MPG-074) — a solo real-time puzzle implementing the pure
// RealtimeModule<S, I> contract (ADR 0002). Swipe to slide every tile in one
// direction; equal tiles that collide merge into their sum and score their sum;
// each successful move spawns a new 2 (or, rarely, a 4) on a random empty cell.
// The run ends when the board is full and no move would change it.
//
// The grid size is a customization (MPG-096 / ADR 0007): the module is built by
// `createGame2048(size)` for size 3, 4 (the canonical default), or 5, each a
// distinct registered module with its own id — so a 3×3 board and a 5×5 board are
// different games and rank on separate leaderboards (ADR 0007 §5 fairness), never
// mixed. The board carries its own dimension implicitly (`board.length === size²`),
// so nothing downstream needs the size threaded separately.
//
// PURE, exactly like the other realtime modules: no clock, no rAF, no
// Math.random. Tile spawns derive entirely from the seeded PRNG carried in
// state (see ./prng), so a run is a deterministic function of (seed, input log)
// — replayable server-side to validate a submitted score (MPG-065). The rAF
// loop, wall-clock pacing, input sampling and rendering all live in the web
// controller/renderer.

import { nextFloat, seedPrng, type PrngState } from "./prng";
import type { RealtimeGameId, RealtimeModule } from "./realtime";

/** The four swipe directions; `null` is "no input this tick" (most ticks). */
export type SwipeDir = "up" | "down" | "left" | "right";

/** Per-tick input: a swipe is a rising edge (present only on the tick requested). */
export interface Game2048Input {
  readonly swipe: SwipeDir | null;
}

export interface Game2048State {
  /**
   * Row-major `size × size` grid of tile values; `0` is an empty cell. Values are
   * always powers of two (2, 4, 8, …). Index `r * size + c`. The grid dimension
   * is `Math.sqrt(board.length)` — the state carries its own size.
   */
  readonly board: readonly number[];
  readonly score: number;
  readonly over: boolean;
  readonly rng: PrngState;
}

/** Selectable grid sizes; 4 is the canonical/default board. */
export const GAME_2048_SIZES = [3, 4, 5] as const;
export type Game2048Size = (typeof GAME_2048_SIZES)[number];
export const DEFAULT_2048_SIZE: Game2048Size = 4;

export const GAME_2048 = {
  /** The default board is SIZE x SIZE (variants use {@link GAME_2048_SIZES}). */
  size: DEFAULT_2048_SIZE,
  /** Value of a freshly-spawned tile in the common case. */
  spawnLow: 2,
  /** ...and in the rare case (see {@link GAME_2048.spawnHighChance}). */
  spawnHigh: 4,
  /** Probability a spawned tile is a 4 rather than a 2 (classic 2048 is 0.1). */
  spawnHighChance: 0.1,
} as const;

/** The registered id for a given grid size — `2048` for the default, `2048@N` otherwise. */
export function game2048IdForSize(size: Game2048Size): RealtimeGameId {
  return size === 3 ? "2048@3" : size === 5 ? "2048@5" : "2048";
}

/** The grid dimension carried by a state (`board.length === size²`). */
export function game2048Size(state: Game2048State): number {
  return Math.round(Math.sqrt(state.board.length));
}

/**
 * 20Hz, deliberately far below the 60Hz the arcade games use. 2048 is
 * turn-like — a swipe applies to a settled board and nothing animates in the
 * sim itself — so the tick rate only needs to feel instant to a human (50ms is
 * imperceptible), and a lower rate keeps the recorded input log (one entry per
 * tick, replayed server-side) small for a puzzle that can last minutes.
 */
const TICK_HZ = 20;

/**
 * Slides one line of `size` values toward its front (index 0), merging each equal
 * adjacent pair exactly once. Returns the packed line and the score gained (the
 * sum of the merged tiles). Pure.
 */
function slideLine(line: readonly number[], size: number): { line: number[]; gained: number } {
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
  while (out.length < size) out.push(0);
  return { line: out, gained };
}

/** The `size` board indices of one line, ordered so the tiles move toward index 0. */
function lineIndices(dir: SwipeDir, i: number, size: number): number[] {
  const fwd = Array.from({ length: size }, (_, k) => k);
  switch (dir) {
    case "left":
      return fwd.map((c) => i * size + c);
    case "right":
      return fwd.reverse().map((c) => i * size + c);
    case "up":
      return fwd.map((r) => r * size + i);
    case "down":
      return fwd.reverse().map((r) => r * size + i);
  }
}

/**
 * Applies a swipe to the board. Returns the new board, the score gained, and
 * whether anything actually moved (an unchanged board is a no-op that must NOT
 * spawn a tile — the classic rule). Pure. `size` defaults to the classic 4.
 */
export function applySwipe(
  board: readonly number[],
  dir: SwipeDir,
  size: number = GAME_2048.size,
): { board: number[]; gained: number; moved: boolean } {
  const next = board.slice();
  let gained = 0;
  let moved = false;
  for (let i = 0; i < size; i += 1) {
    const idx = lineIndices(dir, i, size);
    const before = idx.map((j) => board[j] ?? 0);
    const { line, gained: g } = slideLine(before, size);
    gained += g;
    for (let k = 0; k < size; k += 1) {
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
function canMove(board: readonly number[], size: number): boolean {
  for (let i = 0; i < board.length; i += 1) {
    const v = board[i];
    if (v === undefined) continue;
    if (v === 0) return true;
    const r = Math.floor(i / size);
    const c = i % size;
    if (c + 1 < size && board[i + 1] === v) return true;
    if (r + 1 < size && board[i + size] === v) return true;
  }
  return false;
}

/** The largest tile on the board — the number a player brags about. */
export function highestTile(state: Game2048State): number {
  return state.board.reduce((max, v) => (v > max ? v : max), 0);
}

/**
 * Builds a 2048 module for a given grid size. Size 4 is the canonical `2048`;
 * 3 and 5 are separate registered games (`2048@3` / `2048@5`) with their own
 * boards. All share this one implementation — only the dimension differs.
 */
export function createGame2048(size: Game2048Size): RealtimeModule<Game2048State, Game2048Input> {
  return {
    id: game2048IdForSize(size),
    kind: "realtime",
    tickHz: TICK_HZ,

    createInitialState(seed: number): Game2048State {
      let board: number[] = new Array(size * size).fill(0);
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

      const { board, gained, moved } = applySwipe(state.board, input.swipe, size);
      if (!moved) return state;

      const spawned = spawnTile(board, state.rng);
      const over = !canMove(spawned.board, size);
      return { board: spawned.board, score: state.score + gained, over, rng: spawned.rng };
    },

    getScore(state: Game2048State): number {
      return state.score;
    },

    isGameOver(state: Game2048State): boolean {
      return state.over;
    },
  };
}

/** The canonical 4×4 game. */
export const game2048 = createGame2048(4);
/** The 3×3 variant (its own leaderboard). */
export const game2048_3 = createGame2048(3);
/** The 5×5 variant (its own leaderboard). */
export const game2048_5 = createGame2048(5);
