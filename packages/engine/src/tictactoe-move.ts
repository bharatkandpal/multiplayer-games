// Tic-Tac-Toe "Move mode" game module: each side has exactly 3 marks. While a side has
// fewer than 3 marks on the board it places; once all 3 are down it instead relocates one
// of its own marks to any empty cell (not just an adjacent one). A win is still 3-in-a-row
// and can happen in either phase. Because the move phase never changes how many cells are
// filled (a relocation removes one mark and adds one back), turn order cannot be derived
// from a fill-count parity the way classic Tic-Tac-Toe does — the state tracks whose turn
// it is explicitly. The board can also never fill up (one side always has < 3 pieces
// permanently, and even at 6 marks down cells stay open), so there is no "full board" draw;
// the only draw condition is threefold repetition of the same position (board + side to
// move). See tictactoe.ts for the sibling classic-mode module this mirrors.

import type { GameModule, Player, Result } from "./types";
import { IllegalMoveError } from "./errors";

/** A board cell: empty, or the (1-based) player who occupies it. */
export type Cell = Player | null;

/**
 * 3x3 board flattened row-major, index 0..8 (row = i / 3, col = i % 3), plus the side to
 * move (not derivable from the board once both sides have all 3 pieces down) and a
 * position-key history used for threefold-repetition draw detection. `history` includes
 * the initial position's key, so a position that recurs twice more after the start counts
 * as its 3rd occurrence.
 */
export interface TicTacToeMoveState {
  readonly board: readonly Cell[];
  readonly toMove: Player;
  readonly history: readonly string[];
}

/**
 * A placement (while the mover has fewer than 3 marks on the board) or a relocation of one
 * of the mover's own marks to any empty cell (once the mover has all 3 marks down).
 */
export type TicTacToeMoveMove =
  | { readonly kind: "place"; readonly cell: number }
  | { readonly kind: "relocate"; readonly from: number; readonly to: number };

/** A winning line: the 3 board indices (0..8) that complete it. */
export type TicTacToeMoveLine = readonly [number, number, number];

const BOARD_SIZE = 9;
const PIECES_PER_PLAYER = 3;
const PLAYER_X = 1;
const REPETITION_LIMIT = 3;

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

function countMarksOf(board: readonly Cell[], player: Player): number {
  let count = 0;
  for (const cell of board) {
    if (cell === player) count++;
  }
  return count;
}

/** Serializes a position (board + side to move) for threefold-repetition detection. */
function positionKey(board: readonly Cell[], toMove: Player): string {
  return `${board.join(",")}|${toMove}`;
}

function currentPlayer(state: TicTacToeMoveState): Player {
  return state.toMove;
}

function winnerOf(board: readonly Cell[]): { winner: Player; line: TicTacToeMoveLine } | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark !== null && mark !== undefined && mark === board[b] && mark === board[c]) {
      return { winner: mark, line };
    }
  }
  return null;
}

function getResult(state: TicTacToeMoveState): Result<TicTacToeMoveLine> {
  const win = winnerOf(state.board);
  if (win !== null) {
    return { status: "win", winner: win.winner, line: win.line };
  }
  const key = positionKey(state.board, state.toMove);
  const occurrences = state.history.filter((k) => k === key).length;
  if (occurrences >= REPETITION_LIMIT) {
    return { status: "draw" };
  }
  return { status: "in_progress" };
}

function legalMoves(state: TicTacToeMoveState): TicTacToeMoveMove[] {
  if (getResult(state).status !== "in_progress") {
    return [];
  }
  const mover = currentPlayer(state);
  const moves: TicTacToeMoveMove[] = [];
  const empties: number[] = [];
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i] === null) empties.push(i);
  }
  if (countMarksOf(state.board, mover) < PIECES_PER_PLAYER) {
    for (const cell of empties) {
      moves.push({ kind: "place", cell });
    }
  } else {
    for (let from = 0; from < state.board.length; from++) {
      if (state.board[from] !== mover) continue;
      for (const to of empties) {
        moves.push({ kind: "relocate", from, to });
      }
    }
  }
  return moves;
}

function isInBounds(cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < BOARD_SIZE;
}

function applyMove(
  state: TicTacToeMoveState,
  move: TicTacToeMoveMove,
  player: Player
): TicTacToeMoveState {
  if (getResult(state).status !== "in_progress") {
    throw new IllegalMoveError("game_over", "The game has already ended.");
  }
  if (player !== currentPlayer(state)) {
    throw new IllegalMoveError("not_your_turn", `It is not player ${player}'s turn.`);
  }
  const marksDown = countMarksOf(state.board, player);

  let board: Cell[];
  if (move.kind === "place") {
    if (marksDown >= PIECES_PER_PLAYER) {
      throw new IllegalMoveError(
        "illegal_move",
        `Player ${player} already has all ${PIECES_PER_PLAYER} pieces on the board; must relocate.`
      );
    }
    if (!isInBounds(move.cell)) {
      throw new IllegalMoveError("out_of_bounds", `Cell ${move.cell} is out of bounds.`);
    }
    if (state.board[move.cell] !== null) {
      throw new IllegalMoveError("illegal_move", `Cell ${move.cell} is already occupied.`);
    }
    board = state.board.slice();
    board[move.cell] = player;
  } else {
    if (marksDown < PIECES_PER_PLAYER) {
      throw new IllegalMoveError(
        "illegal_move",
        `Player ${player} still has pieces to place and cannot relocate yet.`
      );
    }
    if (!isInBounds(move.from) || !isInBounds(move.to)) {
      throw new IllegalMoveError(
        "out_of_bounds",
        `Cell ${!isInBounds(move.from) ? move.from : move.to} is out of bounds.`
      );
    }
    if (state.board[move.from] !== player) {
      throw new IllegalMoveError(
        "illegal_move",
        `Cell ${move.from} is not one of player ${player}'s pieces.`
      );
    }
    if (state.board[move.to] !== null) {
      throw new IllegalMoveError("illegal_move", `Cell ${move.to} is already occupied.`);
    }
    board = state.board.slice();
    board[move.from] = null;
    board[move.to] = player;
  }

  const nextToMove = player === PLAYER_X ? 2 : PLAYER_X;
  const history = [...state.history, positionKey(board, nextToMove)];
  return { board, toMove: nextToMove, history };
}

/**
 * Line-potential heuristic (same style as classic tictactoe.ts): for each of the 8 lines
 * not blocked by the opponent, score by how many of `forPlayer`'s marks it contains (and
 * symmetrically negative for lines the opponent could still complete). Works unchanged in
 * both the placement and move phases since it only looks at the current board.
 */
function evaluate(state: TicTacToeMoveState, forPlayer: Player): number {
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

/**
 * Orders moves by a 1-ply lookahead (the resulting position's `evaluate` score for the
 * mover), descending — winning/strong moves first. Unlike Connect Four's static
 * center-first ordering, this game has no fixed "best" cell (a relocation's value depends
 * entirely on the current board), so a cheap lookahead is used instead. This meaningfully
 * improves alpha-beta pruning in the move phase, where the branching factor (own pieces x
 * empty cells) doesn't shrink over time the way classic Tic-Tac-Toe's does.
 */
function orderMoves(state: TicTacToeMoveState, moves: TicTacToeMoveMove[]): TicTacToeMoveMove[] {
  const mover = currentPlayer(state);
  return moves
    .map((move) => ({ move, score: evaluate(applyMove(state, move, mover), mover) }))
    .sort((a, b) => b.score - a.score)
    .map(({ move }) => move);
}

function createInitialState(): TicTacToeMoveState {
  const board = new Array<Cell>(BOARD_SIZE).fill(null);
  return { board, toMove: PLAYER_X, history: [positionKey(board, PLAYER_X)] };
}

/** The Tic-Tac-Toe "Move mode" `GameModule`: place-then-slide 3-piece variant. */
export const ticTacToeMove: GameModule<TicTacToeMoveState, TicTacToeMoveMove, TicTacToeMoveLine> =
  {
    id: "tictactoe-move",
    playerCount: 2,
    createInitialState,
    legalMoves,
    applyMove,
    getResult,
    currentPlayer,
    evaluate,
    orderMoves,
  };
