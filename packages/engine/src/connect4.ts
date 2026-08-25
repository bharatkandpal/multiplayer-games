// Connect Four game module. See docs/GAME_LOGIC.md §2 for rules and §3.1 for the heuristic.

import type { GameModule, Player, Result } from "./types";
import { IllegalMoveError } from "./errors";

/** A board cell: empty, or the (1-based) player who occupies it. */
export type Cell = Player | null;

/** Board dimensions. */
const COLUMNS = 7;
const ROWS = 6;

const PLAYER_ONE = 1;
const PLAYER_TWO = 2;

/**
 * Column-major board: `board[col][row]`, `col` 0..6 (left to right), `row` 0..5
 * (0 = bottom row, 5 = top row). A disc dropped into a column occupies the lowest
 * `row` index whose cell is still `null` (gravity).
 */
export interface ConnectFourState {
  readonly board: readonly (readonly Cell[])[];
}

/** Drop a disc into `column`, 0..6. */
export interface ConnectFourMove {
  readonly column: number;
}

function countFilled(state: ConnectFourState): number {
  let count = 0;
  for (const col of state.board) {
    for (const cell of col) {
      if (cell !== null) count++;
    }
  }
  return count;
}

/** The player whose turn it is, derived from how many discs are on the board. */
function currentPlayer(state: ConnectFourState): Player {
  return countFilled(state) % 2 === 0 ? PLAYER_ONE : PLAYER_TWO;
}

/** The row a disc would land in for `column`, or -1 if the column is full. */
function landingRow(state: ConnectFourState, column: number): number {
  const col = state.board[column];
  if (col === undefined) return -1;
  for (let row = 0; row < ROWS; row++) {
    if (col[row] === null) return row;
  }
  return -1;
}

function cellAt(state: ConnectFourState, col: number, row: number): Cell | undefined {
  if (col < 0 || col >= COLUMNS || row < 0 || row >= ROWS) return undefined;
  return state.board[col]?.[row] ?? null;
}

/** The four line directions checked for a win: horizontal, vertical, and both diagonals. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0], // horizontal
  [0, 1], // vertical
  [1, 1], // diagonal up-right (↗)
  [1, -1], // diagonal down-right (↘)
];

function winnerOf(state: ConnectFourState): Player | null {
  for (let col = 0; col < COLUMNS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const mark = cellAt(state, col, row);
      if (mark === null || mark === undefined) continue;
      for (const [dc, dr] of DIRECTIONS) {
        let inARow = 1;
        for (let step = 1; step < 4; step++) {
          if (cellAt(state, col + dc * step, row + dr * step) === mark) {
            inARow++;
          } else {
            break;
          }
        }
        if (inARow >= 4) return mark;
      }
    }
  }
  return null;
}

function getResult(state: ConnectFourState): Result {
  const winner = winnerOf(state);
  if (winner !== null) {
    return { status: "win", winner };
  }
  if (countFilled(state) === COLUMNS * ROWS) {
    return { status: "draw" };
  }
  return { status: "in_progress" };
}

function legalMoves(state: ConnectFourState): ConnectFourMove[] {
  if (getResult(state).status !== "in_progress") {
    return [];
  }
  const moves: ConnectFourMove[] = [];
  for (let column = 0; column < COLUMNS; column++) {
    if (landingRow(state, column) !== -1) {
      moves.push({ column });
    }
  }
  return moves;
}

function applyMove(
  state: ConnectFourState,
  move: ConnectFourMove,
  player: Player,
): ConnectFourState {
  if (getResult(state).status !== "in_progress") {
    throw new IllegalMoveError("game_over", "The game has already ended.");
  }
  if (player !== currentPlayer(state)) {
    throw new IllegalMoveError("not_your_turn", `It is not player ${player}'s turn.`);
  }
  if (!Number.isInteger(move.column) || move.column < 0 || move.column >= COLUMNS) {
    throw new IllegalMoveError("out_of_bounds", `Column ${move.column} is out of bounds.`);
  }
  const row = landingRow(state, move.column);
  if (row === -1) {
    throw new IllegalMoveError("illegal_move", `Column ${move.column} is full.`);
  }
  const board = state.board.map((col, c) =>
    c === move.column ? col.map((cell, r) => (r === row ? player : cell)) : col,
  );
  return { board };
}

/** Score for a 4-cell window: how "good" it is for `forPlayer`. */
function scoreWindow(window: readonly Cell[], forPlayer: Player): number {
  const forCount = window.filter((c) => c === forPlayer).length;
  const otherCount = window.filter((c) => c !== null && c !== forPlayer).length;
  if (forCount > 0 && otherCount > 0) {
    return 0; // blocked window, no potential either way
  }
  if (forCount === 4) return 100000;
  if (forCount === 3) return 100;
  if (forCount === 2) return 10;
  if (otherCount === 4) return -100000;
  // Weight opponent threats slightly higher than symmetric AI potential to prefer blocking.
  if (otherCount === 3) return -150;
  if (otherCount === 2) return -15;
  return 0;
}

/**
 * Open-window heuristic: slide every possible 4-cell window (horizontal, vertical, both
 * diagonals) and sum {@link scoreWindow} across them, plus a small center-column control
 * bonus. Only meaningful at non-terminal minimax depth cutoffs — see docs/GAME_LOGIC.md §3.1.
 */
function evaluate(state: ConnectFourState, forPlayer: Player): number {
  let score = 0;

  for (let col = 0; col < COLUMNS; col++) {
    for (let row = 0; row < ROWS; row++) {
      for (const [dc, dr] of DIRECTIONS) {
        const endCol = col + dc * 3;
        const endRow = row + dr * 3;
        // Only evaluate each window once: require it to stay in bounds and (for
        // directions that can run "backwards", i.e. dr === -1) start high enough.
        if (endCol < 0 || endCol >= COLUMNS || endRow < 0 || endRow >= ROWS) continue;
        const window: Cell[] = [];
        for (let step = 0; step < 4; step++) {
          window.push(cellAt(state, col + dc * step, row + dr * step) ?? null);
        }
        score += scoreWindow(window, forPlayer);
      }
    }
  }

  // Center-column control bonus: discs in the middle column participate in more
  // potential lines, so nudge the score toward center play.
  const centerColumn = state.board[Math.floor(COLUMNS / 2)];
  if (centerColumn !== undefined) {
    for (const cell of centerColumn) {
      if (cell === forPlayer) score += 3;
      else if (cell !== null) score -= 3;
    }
  }

  return score;
}

/** Column visit order for search: center-out, since central columns open more lines. */
const CENTER_FIRST_COLUMNS = [3, 2, 4, 1, 5, 0, 6];

/** Center-first move ordering (see docs/GAME_LOGIC.md §3) — improves alpha-beta pruning. */
function orderMoves(_state: ConnectFourState, moves: ConnectFourMove[]): ConnectFourMove[] {
  const byColumn = new Map(moves.map((move) => [move.column, move]));
  const ordered: ConnectFourMove[] = [];
  for (const column of CENTER_FIRST_COLUMNS) {
    const move = byColumn.get(column);
    if (move !== undefined) ordered.push(move);
  }
  return ordered;
}

function createInitialState(): ConnectFourState {
  const board: Cell[][] = [];
  for (let col = 0; col < COLUMNS; col++) {
    board.push(new Array<Cell>(ROWS).fill(null));
  }
  return { board };
}

/** The Connect Four `GameModule`: a 2-player, 7x6 gravity-drop grid game. */
export const connectFour: GameModule<ConnectFourState, ConnectFourMove> = {
  id: "connect4",
  playerCount: 2,
  createInitialState,
  legalMoves,
  applyMove,
  getResult,
  currentPlayer,
  evaluate,
  orderMoves,
};
