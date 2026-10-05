// Minesweeper board engine (GAME-005b) — the pure rules half of the solo Minesweeper
// game. The `RealtimeModule` wrapper (tick, clock, score) is GAME-005c; this file knows
// nothing about ticks or scoring, only the board.
//
// PURE, like every engine module: no clock, no `Math.random`. Mine placement draws from
// the seeded PRNG carried inside the board, so a board is a deterministic function of
// (seed, reveal sequence) — replayable server-side to validate a submitted score.
//
// **Mines are placed on the FIRST reveal, not at creation.** That is how the first
// reveal is guaranteed safe (the layout is chosen knowing where the player clicked),
// and it costs nothing in determinism: the PRNG state is the same either way, and the
// placement is still a pure function of (seed, first cell).
//
// **Operations are total, never throwing.** `reveal` / `toggleFlag` on an out-of-range
// index, a finished board, a flagged cell, or an already-revealed cell return the board
// unchanged. The server replays a client-supplied input log through this code; a
// tampered log must degrade to "no-op", not to a thrown error on the submit path.

import { nextFloat, seedPrng, type PrngState } from "./prng";

/** Board dimensions and mine count. v1 ships one config; larger boards come with ParamSchema. */
export interface MinesweeperConfig {
  readonly cols: number;
  readonly rows: number;
  readonly mines: number;
}

/**
 * The v1 board: 6×8, 7 mines. Sized so every cell is a 44px touch target inside a
 * 320px viewport with 16px gutters (docs/UX_PRINCIPLES.md §7) — see GAME-005a.
 */
export const MINESWEEPER_V1: MinesweeperConfig = { cols: 6, rows: 8, mines: 7 };

/** `ready` = nothing revealed yet (mines not placed); `playing`; then `won` or `lost`. */
export type MinesweeperStatus = "ready" | "playing" | "won" | "lost";

export interface MinesweeperBoard {
  readonly config: MinesweeperConfig;
  /** Row-major (`row * cols + col`); `null` until the first reveal places the mines. */
  readonly mines: readonly boolean[] | null;
  readonly revealed: readonly boolean[];
  readonly flagged: readonly boolean[];
  readonly status: MinesweeperStatus;
  /** The mine the player hit, once `lost`. */
  readonly exploded: number | null;
  readonly rng: PrngState;
}

function cellCount(config: MinesweeperConfig): number {
  return config.cols * config.rows;
}

/** A fresh, untouched board. Nothing is a mine yet — see the file header. */
export function createBoard(
  seed: number,
  config: MinesweeperConfig = MINESWEEPER_V1,
): MinesweeperBoard {
  const total = cellCount(config);
  if (
    !Number.isInteger(config.cols) ||
    !Number.isInteger(config.rows) ||
    !Number.isInteger(config.mines) ||
    config.cols < 1 ||
    config.rows < 1 ||
    config.mines < 1 ||
    config.mines >= total
  ) {
    throw new RangeError(`invalid Minesweeper config: ${JSON.stringify(config)}`);
  }
  return {
    config,
    mines: null,
    revealed: new Array<boolean>(total).fill(false),
    flagged: new Array<boolean>(total).fill(false),
    status: "ready",
    exploded: null,
    rng: seedPrng(seed),
  };
}

function inRange(board: MinesweeperBoard, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < cellCount(board.config);
}

/** Indices of the (up to 8) cells around `index`, clipped at the edges. */
export function neighbors(config: MinesweeperConfig, index: number): number[] {
  const col = index % config.cols;
  const row = Math.floor(index / config.cols);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= config.rows || c < 0 || c >= config.cols) continue;
      out.push(r * config.cols + c);
    }
  }
  return out;
}

/**
 * Places the mines, keeping `first` and its neighbours clear — so the first reveal is
 * always a zero and opens an area, never a lone number. If the board is too crowded to
 * spare the whole neighbourhood, only `first` itself is kept clear. Partial
 * Fisher–Yates over the eligible cells, drawing from the seeded PRNG.
 */
function placeMines(
  config: MinesweeperConfig,
  first: number,
  rng: PrngState,
): { mines: boolean[]; rng: PrngState } {
  const total = cellCount(config);
  const wide = new Set([first, ...neighbors(config, first)]);
  const clear = total - wide.size >= config.mines ? wide : new Set([first]);

  const pool: number[] = [];
  for (let i = 0; i < total; i += 1) if (!clear.has(i)) pool.push(i);

  const mines = new Array<boolean>(total).fill(false);
  let state = rng;
  for (let k = 0; k < config.mines; k += 1) {
    const roll = nextFloat(state);
    state = roll.next;
    const pick = k + Math.floor(roll.value * (pool.length - k));
    const chosen = pool[pick] as number;
    pool[pick] = pool[k] as number;
    pool[k] = chosen;
    mines[chosen] = true;
  }
  return { mines, rng: state };
}

/** Mines touching `index`. 0 before the first reveal (no layout exists yet). */
export function adjacentMines(board: MinesweeperBoard, index: number): number {
  if (board.mines === null || !inRange(board, index)) return 0;
  const mines = board.mines;
  return neighbors(board.config, index).filter((n) => mines[n]).length;
}

/** Whether `index` is a mine. Only meaningful to show once the board is `lost`/`won`. */
export function isMine(board: MinesweeperBoard, index: number): boolean {
  return board.mines?.[index] === true;
}

/** Whether the board has reached a terminal state. */
export function isOver(board: MinesweeperBoard): boolean {
  return board.status === "won" || board.status === "lost";
}

/** Mines minus flags placed — can go negative if the player over-flags. For the counter. */
export function flagsRemaining(board: MinesweeperBoard): number {
  return board.config.mines - board.flagged.filter(Boolean).length;
}

/**
 * Reveals a cell. Revealing a zero floods outward through connected zeros and the
 * numbers bordering them; flagged cells stop the flood and are never auto-revealed.
 * Revealing a mine ends the board `lost`; revealing the last safe cell ends it `won`.
 */
export function reveal(board: MinesweeperBoard, index: number): MinesweeperBoard {
  if (!inRange(board, index) || isOver(board)) return board;
  if (board.flagged[index] || board.revealed[index]) return board;

  let mines = board.mines;
  let rng = board.rng;
  if (mines === null) {
    const placed = placeMines(board.config, index, rng);
    mines = placed.mines;
    rng = placed.rng;
  }

  if (mines[index]) {
    const revealed = board.revealed.slice();
    revealed[index] = true;
    return { ...board, mines, rng, revealed, status: "lost", exploded: index };
  }

  const revealed = board.revealed.slice();
  const queue = [index];
  revealed[index] = true;
  while (queue.length > 0) {
    const current = queue.pop() as number;
    const around = neighbors(board.config, current);
    if (around.some((n) => mines[n])) continue; // a number: reveal it, don't expand
    for (const n of around) {
      if (revealed[n] || board.flagged[n]) continue;
      revealed[n] = true;
      queue.push(n);
    }
  }

  const safeCells = cellCount(board.config) - board.config.mines;
  const won = revealed.filter(Boolean).length === safeCells;
  return {
    ...board,
    mines,
    rng,
    revealed,
    status: won ? "won" : "playing",
  };
}

/** Flags or unflags a hidden cell. A no-op on a revealed cell or a finished board. */
export function toggleFlag(board: MinesweeperBoard, index: number): MinesweeperBoard {
  if (!inRange(board, index) || isOver(board) || board.revealed[index]) return board;
  const flagged = board.flagged.slice();
  flagged[index] = !flagged[index];
  return { ...board, flagged };
}
