// Nim game module (normal play convention). See docs/GAME_LOGIC.md.
//
// Unlike Tic-Tac-Toe/Connect Four (where every move places exactly one mark, so the ply
// count — and thus whose turn it is — falls out of how many cells are filled), a Nim move
// can remove a variable number of objects from a pile. The number of moves played is not
// recoverable from the piles alone, so (uniquely among this platform's turn-based games so
// far) `NimState` carries an explicit `toMove` field.

import type { GameModule, Player, Result } from "./types";
import { IllegalMoveError } from "./errors";

/** Nim is 2-player only (no misère variant, no N-player generalization needed here). */
const PLAYER_ONE = 1;
const PLAYER_TWO = 2;

/** A reasonable default layout: 4 small, distinct piles — a quick, legible starting position. */
export const DEFAULT_PILES: readonly number[] = [1, 3, 5, 7];

/** Pile sizes (remaining objects) plus whose turn it is. */
export interface NimState {
  readonly piles: readonly number[];
  readonly toMove: Player;
}

/** Take `count` (1..pile's current size) objects from pile index `pile`. */
export interface NimMove {
  readonly pile: number;
  readonly count: number;
}

/** The "line" for a Nim win: every (now-empty) pile index, for the UI to highlight. */
export type NimLine = readonly number[];

function otherPlayer(player: Player): Player {
  return player === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE;
}

function isEmpty(piles: readonly number[]): boolean {
  return piles.every((n) => n === 0);
}

/**
 * Normal play convention: whoever takes the last object(s) wins. Once all piles are
 * empty, `state.toMove` already points at the player who is stuck with no move — the
 * winner is the *other* player, i.e. whoever moved last.
 */
function getResult(state: NimState): Result<NimLine> {
  if (isEmpty(state.piles)) {
    return {
      status: "win",
      winner: otherPlayer(state.toMove),
      line: state.piles.map((_, i) => i),
    };
  }
  return { status: "in_progress" };
}

function legalMoves(state: NimState): NimMove[] {
  if (getResult(state).status !== "in_progress") {
    return [];
  }
  const moves: NimMove[] = [];
  state.piles.forEach((size, pile) => {
    for (let count = 1; count <= size; count++) {
      moves.push({ pile, count });
    }
  });
  return moves;
}

function currentPlayer(state: NimState): Player {
  return state.toMove;
}

function applyMove(state: NimState, move: NimMove, player: Player): NimState {
  if (getResult(state).status !== "in_progress") {
    throw new IllegalMoveError("game_over", "The game has already ended.");
  }
  if (player !== state.toMove) {
    throw new IllegalMoveError("not_your_turn", `It is not player ${player}'s turn.`);
  }
  if (!Number.isInteger(move.pile) || move.pile < 0 || move.pile >= state.piles.length) {
    throw new IllegalMoveError("out_of_bounds", `Pile ${move.pile} is out of bounds.`);
  }
  const size = state.piles[move.pile] as number;
  if (!Number.isInteger(move.count) || move.count < 1 || move.count > size) {
    throw new IllegalMoveError(
      "illegal_move",
      `Cannot take ${move.count} from pile ${move.pile} (has ${size}).`,
    );
  }
  const piles = state.piles.slice();
  piles[move.pile] = size - move.count;
  return { piles, toMove: otherPlayer(state.toMove) };
}

/**
 * Heuristic sign from `forPlayer`'s perspective, based on the Nim-sum (XOR of pile
 * sizes) — see `ai/heuristics/nim.ts` for the full closed-form strategy this reflects.
 * A nonzero Nim-sum is winning for whoever is to move; zero is a loss for the mover
 * under optimal opposing play. This is exact (not just a shallow-search proxy), but is
 * still exposed as `evaluate` for `GameModule` completeness / generic-minimax fallback.
 */
function evaluate(state: NimState, forPlayer: Player): number {
  const nimSum = state.piles.reduce((acc, n) => acc ^ n, 0);
  const winningForMover = nimSum !== 0;
  const moverIsForPlayer = currentPlayer(state) === forPlayer;
  const favorsForPlayer = winningForMover === moverIsForPlayer;
  return favorsForPlayer ? 1 : -1;
}

function createInitialState(): NimState {
  return { piles: DEFAULT_PILES.slice(), toMove: PLAYER_ONE };
}

/** The Nim `GameModule`: normal-play, configurable-pile take-away game. */
export const nim: GameModule<NimState, NimMove, NimLine> = {
  id: "nim",
  playerCount: 2,
  createInitialState,
  legalMoves,
  applyMove,
  getResult,
  currentPlayer,
  evaluate,
};
