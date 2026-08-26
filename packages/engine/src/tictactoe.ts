// Tic-Tac-Toe game module. See docs/GAME_LOGIC.md §1 for rules and §3.1 for the heuristic.

import type { GameModule, Player, Result } from "./types";
import { IllegalMoveError } from "./errors";

/** A board cell: empty, or the (1-based) player who occupies it. */
export type Cell = Player | null;

/** 3x3 board flattened row-major, index 0..8 (row = i / 3, col = i % 3). */
export interface TicTacToeState {
  readonly board: readonly Cell[];
}

/** Place a mark in an empty cell, index 0..8. */
export interface TicTacToeMove {
  readonly cell: number;
}

/** A winning line: the 3 board indices (0..8) that complete it. */
export type TicTacToeLine = readonly [number, number, number];

const BOARD_SIZE = 9;
const PLAYER_X = 1;
const PLAYER_O = 2;

/** All 8 winning lines: 3 rows, 3 columns, 2 diagonals. */
const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function countFilled(board: readonly Cell[]): number {
  let count = 0;
  for (const cell of board) {
    if (cell !== null) count++;
  }
  return count;
}

/** The player whose turn it is, derived from how many cells are filled (X moves first). */
function currentPlayer(state: TicTacToeState): Player {
  return countFilled(state.board) % 2 === 0 ? PLAYER_X : PLAYER_O;
}

function winnerOf(board: readonly Cell[]): { winner: Player; line: TicTacToeLine } | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark !== null && mark !== undefined && mark === board[b] && mark === board[c]) {
      return { winner: mark, line };
    }
  }
  return null;
}

function getResult(state: TicTacToeState): Result<TicTacToeLine> {
  const win = winnerOf(state.board);
  if (win !== null) {
    return { status: "win", winner: win.winner, line: win.line };
  }
  if (countFilled(state.board) === BOARD_SIZE) {
    return { status: "draw", reason: "board-full" };
  }
  return { status: "in_progress" };
}

function legalMoves(state: TicTacToeState): TicTacToeMove[] {
  if (getResult(state).status !== "in_progress") {
    return [];
  }
  const moves: TicTacToeMove[] = [];
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i] === null) {
      moves.push({ cell: i });
    }
  }
  return moves;
}

function applyMove(state: TicTacToeState, move: TicTacToeMove, player: Player): TicTacToeState {
  if (getResult(state).status !== "in_progress") {
    throw new IllegalMoveError("game_over", "The game has already ended.");
  }
  if (player !== currentPlayer(state)) {
    throw new IllegalMoveError("not_your_turn", `It is not player ${player}'s turn.`);
  }
  if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= BOARD_SIZE) {
    throw new IllegalMoveError("out_of_bounds", `Cell ${move.cell} is out of bounds.`);
  }
  if (state.board[move.cell] !== null) {
    throw new IllegalMoveError("illegal_move", `Cell ${move.cell} is already occupied.`);
  }
  const board = state.board.slice();
  board[move.cell] = player;
  return { board };
}

/**
 * Simple line-potential heuristic: for each of the 8 lines not blocked by the opponent,
 * score by how many of `forPlayer`'s marks it contains (and symmetrically negative for
 * lines the opponent could still complete). Only meaningful at shallow minimax depth
 * cutoffs — Hard difficulty searches to terminal states, where this is unused.
 */
function evaluate(state: TicTacToeState, forPlayer: Player): number {
  const { board } = state;
  let score = 0;
  for (const [a, b, c] of LINES) {
    const marks = [board[a], board[b], board[c]];
    const forCount = marks.filter((m) => m === forPlayer).length;
    const otherCount = marks.filter((m) => m !== null && m !== undefined && m !== forPlayer).length;
    if (forCount > 0 && otherCount > 0) {
      continue; // blocked line, no potential either way
    }
    if (forCount > 0) {
      score += forCount * forCount;
    } else if (otherCount > 0) {
      score -= otherCount * otherCount;
    }
  }
  return score;
}

/** The Tic-Tac-Toe `GameModule`: a solved, 2-player, 3x3 grid game. */
export const ticTacToe: GameModule<TicTacToeState, TicTacToeMove, TicTacToeLine> = {
  id: "tictactoe",
  playerCount: 2,
  createInitialState: () => ({ board: new Array<Cell>(BOARD_SIZE).fill(null) }),
  legalMoves,
  applyMove,
  getResult,
  currentPlayer,
  evaluate,
};
