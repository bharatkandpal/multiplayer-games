// Gomoku (freestyle, no renju forbidden-move rules) game module. See
// docs/GAME_LOGIC.md for rules conventions shared across games, and the module-level
// comments below for Gomoku's own heuristic + search tuning (it isn't in GAME_LOGIC.md
// yet — added alongside this module, see MPG-069).
//
// Board is 9x9 (smaller than traditional Gomoku's 15x15/19x19) specifically to keep
// minimax depth/branching tractable within the <500ms Hard move-time budget (PRD NFR)
// while keeping games reasonably short.

import type { GameModule, Player, Result } from "./types";
import { IllegalMoveError } from "./errors";

/** A board cell: empty, or the (1-based) player who occupies it. */
export type Cell = Player | null;

/** Board is `size x size`, square. */
const BOARD_SIZE = 9;

/** Number of same-player stones in an unbroken line required to win. */
const WIN_LENGTH = 5;

const PLAYER_ONE = 1;
const PLAYER_TWO = 2;

/**
 * Row-major board: `board[row][col]`, both 0..8. A stone is placed directly on any
 * empty cell — no gravity, no captures, stones never move once placed.
 */
export interface GomokuState {
  readonly board: readonly (readonly Cell[])[];
}

/** Place a stone at `{row, col}`, both 0..8. */
export interface GomokuMove {
  readonly row: number;
  readonly col: number;
}

/** A winning line: the `WIN_LENGTH` board cells (in play order) that complete it. */
export type GomokuLine = readonly GomokuMove[];

function countFilled(state: GomokuState): number {
  let count = 0;
  for (const row of state.board) {
    for (const cell of row) {
      if (cell !== null) count++;
    }
  }
  return count;
}

/** The player whose turn it is, derived from how many stones are on the board. */
function currentPlayer(state: GomokuState): Player {
  return countFilled(state) % 2 === 0 ? PLAYER_ONE : PLAYER_TWO;
}

function cellAt(state: GomokuState, row: number, col: number): Cell | undefined {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return undefined;
  return state.board[row]?.[col] ?? null;
}

/** The four line directions checked for a win: horizontal, vertical, and both diagonals. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1], // horizontal (→)
  [1, 0], // vertical (↓)
  [1, 1], // diagonal down-right (↘)
  [1, -1], // diagonal down-left (↙, i.e. the anti-diagonal)
];

/**
 * Scans every cell as a potential line-start (so lines starting mid-board, not just at an
 * edge, are found) and every direction, counting consecutive same-owner cells. Any run of
 * `WIN_LENGTH` or more wins — freestyle Gomoku places no upper cap ("overline") on the
 * winning run length.
 */
function winnerOf(state: GomokuState): { winner: Player; line: GomokuLine } | null {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const mark = cellAt(state, row, col);
      if (mark === null || mark === undefined) continue;
      for (const [dr, dc] of DIRECTIONS) {
        let inARow = 1;
        for (let step = 1; step < WIN_LENGTH; step++) {
          if (cellAt(state, row + dr * step, col + dc * step) === mark) {
            inARow++;
          } else {
            break;
          }
        }
        if (inARow >= WIN_LENGTH) {
          const line: GomokuLine = Array.from({ length: WIN_LENGTH }, (_, step) => ({
            row: row + dr * step,
            col: col + dc * step,
          }));
          return { winner: mark, line };
        }
      }
    }
  }
  return null;
}

function getResult(state: GomokuState): Result<GomokuLine> {
  const win = winnerOf(state);
  if (win !== null) {
    return { status: "win", winner: win.winner, line: win.line };
  }
  if (countFilled(state) === BOARD_SIZE * BOARD_SIZE) {
    return { status: "draw", reason: "board-full" };
  }
  return { status: "in_progress" };
}

function legalMoves(state: GomokuState): GomokuMove[] {
  if (getResult(state).status !== "in_progress") {
    return [];
  }
  const moves: GomokuMove[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (cellAt(state, row, col) === null) {
        moves.push({ row, col });
      }
    }
  }
  return moves;
}

function applyMove(state: GomokuState, move: GomokuMove, player: Player): GomokuState {
  if (getResult(state).status !== "in_progress") {
    throw new IllegalMoveError("game_over", "The game has already ended.");
  }
  if (player !== currentPlayer(state)) {
    throw new IllegalMoveError("not_your_turn", `It is not player ${player}'s turn.`);
  }
  if (
    !Number.isInteger(move.row) ||
    !Number.isInteger(move.col) ||
    move.row < 0 ||
    move.row >= BOARD_SIZE ||
    move.col < 0 ||
    move.col >= BOARD_SIZE
  ) {
    throw new IllegalMoveError(
      "out_of_bounds",
      `Cell {row: ${move.row}, col: ${move.col}} is out of bounds.`,
    );
  }
  if (state.board[move.row]?.[move.col] !== null) {
    throw new IllegalMoveError(
      "illegal_move",
      `Cell {row: ${move.row}, col: ${move.col}} is already occupied.`,
    );
  }
  const board = state.board.map((r, ri) =>
    ri === move.row ? r.map((c, ci) => (ci === move.col ? player : c)) : r,
  );
  return { board };
}

/** Score weights for a run of `runLength` same-owner stones, by how "open" its ends are. */
function runScore(runLength: number, openEnds: number): number {
  if (runLength >= WIN_LENGTH) return 1_000_000; // already a win (defensive; terminal in practice)
  if (runLength === 4) return openEnds >= 1 ? 100_000 : 1_000; // one open end still forces a block
  if (runLength === 3) return openEnds === 2 ? 5_000 : openEnds === 1 ? 200 : 0;
  if (runLength === 2) return openEnds === 2 ? 100 : openEnds === 1 ? 10 : 0;
  if (runLength === 1) return openEnds === 2 ? 2 : 0;
  return 0;
}

/**
 * Threat-scoring heuristic (see docs/GAME_LOGIC.md-style "open windows" convention used by
 * Connect Four, generalized to Gomoku's pattern vocabulary): scans every direction from
 * every run-start cell (a cell whose predecessor, in that direction, is a different owner
 * or off-board) and scores the run by its length and how many ends are open (an empty,
 * in-bounds cell just past the run) — open runs are far more dangerous than blocked ones
 * because they can still extend into a five, e.g. an "open three" (`.XXX.`) threatens to
 * become an unstoppable "open four" next move, while a "closed three" (`OXXX.` or `.XXXO`)
 * can only ever become a single-ended four. Opponent threats are weighted more heavily than
 * the mirror-image AI threat of the same shape, to bias the AI toward blocking over
 * building (matches Connect Four's `scoreWindow` convention).
 */
function evaluate(state: GomokuState, forPlayer: Player): number {
  const opponentWeight = 1.2;
  let score = 0;

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const owner = cellAt(state, row, col);
      if (owner === null || owner === undefined) continue;

      for (const [dr, dc] of DIRECTIONS) {
        const prev = cellAt(state, row - dr, col - dc);
        if (prev === owner) continue; // not a run start in this direction; already counted

        let runLength = 1;
        while (cellAt(state, row + dr * runLength, col + dc * runLength) === owner) {
          runLength++;
        }

        let openEnds = 0;
        if (prev === null) openEnds++;
        const afterCell = cellAt(state, row + dr * runLength, col + dc * runLength);
        if (afterCell === null) openEnds++;

        const magnitude = runScore(runLength, openEnds);
        if (magnitude === 0) continue;
        score += owner === forPlayer ? magnitude : -magnitude * opponentWeight;
      }
    }
  }

  // Centrality bonus: central cells participate in more potential lines (4 directions x
  // up to WIN_LENGTH windows each), so nudge the score toward central play — same idea as
  // Connect Four's center-column control bonus.
  const center = (BOARD_SIZE - 1) / 2;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const owner = cellAt(state, row, col);
      if (owner === null || owner === undefined) continue;
      const distance = Math.abs(row - center) + Math.abs(col - center);
      const bonus = Math.max(0, center * 2 - distance);
      score += owner === forPlayer ? bonus : -bonus;
    }
  }

  return score;
}

/**
 * How far (in cells, Chebyshev distance) an empty cell may be from an existing stone and
 * still be considered a "plausible" candidate move for search purposes.
 */
const CANDIDATE_RADIUS = 2;

/** Hard upper bound on how many candidate moves `orderMoves` hands to search. */
const MAX_CANDIDATES = 12;

/**
 * Gomoku-specific move ordering **and search-space restriction**. This is a deliberate,
 * documented exception to the generic `GameModule.orderMoves` contract (see types.ts):
 * elsewhere `orderMoves` only reorders, it never drops moves, because the branching factor
 * is small enough that full-width alpha-beta is affordable. Gomoku's 9x9 board (up to 81
 * legal moves) makes that infeasible at a useful depth within the <500ms Hard budget (PRD
 * NFR) — see docs/GAME_LOGIC.md's risk note on Connect Four's much smaller branching factor
 * already needing depth-limiting. Standard Gomoku engines instead restrict the candidate
 * set to cells near existing stones (playing in an empty corner far from all stones is
 * essentially never competitive), then rank by a cheap 1-ply lookahead — the same
 * lookahead-ordering idea `tictactoe-move.ts` uses, applied here to a *restricted* set
 * rather than the full move list. `searchBestMove`/`minimax` (ai/minimax.ts) always search
 * exactly what `orderMoves` returns, so this restriction is the mechanism (not just a
 * speed hint) that keeps Hard's search tractable.
 */
function orderMoves(state: GomokuState, moves: GomokuMove[]): GomokuMove[] {
  const hasStones = moves.length < BOARD_SIZE * BOARD_SIZE;
  const center = Math.floor(BOARD_SIZE / 2);

  const candidates = hasStones
    ? moves.filter(({ row, col }) => {
        for (let dr = -CANDIDATE_RADIUS; dr <= CANDIDATE_RADIUS; dr++) {
          for (let dc = -CANDIDATE_RADIUS; dc <= CANDIDATE_RADIUS; dc++) {
            if (dr === 0 && dc === 0) continue;
            if (cellAt(state, row + dr, col + dc)) return true;
          }
        }
        return false;
      })
    : // Empty board: by symmetry only the center cell is ever worth considering.
      moves.filter(({ row, col }) => row === center && col === center);

  const pool = candidates.length > 0 ? candidates : moves;
  const mover = currentPlayer(state);

  return pool
    .map((move) => ({ move, score: evaluate(applyMove(state, move, mover), mover) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map(({ move }) => move);
}

function createInitialState(): GomokuState {
  const board: Cell[][] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    board.push(new Array<Cell>(BOARD_SIZE).fill(null));
  }
  return { board };
}

/** The Gomoku `GameModule`: a 2-player, 9x9 free-placement, 5-in-a-row grid game. */
export const gomoku: GameModule<GomokuState, GomokuMove, GomokuLine> = {
  id: "gomoku",
  playerCount: 2,
  createInitialState,
  legalMoves,
  applyMove,
  getResult,
  currentPlayer,
  evaluate,
  orderMoves,
};
