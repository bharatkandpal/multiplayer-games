// Nim-specific AI: optimal play via the Nim-sum (Bouton's theorem), not minimax.
//
// Nim has a closed-form solution — the game's entire game-theoretic value is captured by
// XOR-ing the pile sizes — so search is unnecessary and strictly worse (it can only
// rediscover the same answer, slower). This is the platform's first per-game AI override:
// every other game funnels through the generic `pickMove`/`searchBestMove` (minimax); Nim
// is the exception, exactly per docs/GAME_LOGIC.md's guidance to use the closed-form.
//
// Difficulty is layered the same way as the generic picker (see ../difficulty.ts): with
// probability `blunderRate`, play a uniformly random legal move instead of the optimal
// one. Same `Difficulty` union, same "blunder rate" vocabulary — no new scheme.

import type { NimMove, NimState } from "../../nim";
import { nim } from "../../nim";
import type { Difficulty } from "../../types";
import type { Rng } from "../difficulty";

/** XOR of all pile sizes. Zero means the player to move is in a theoretical loss under
 * optimal opposing play (Bouton's theorem); nonzero means they have a winning move. */
export function nimSum(piles: readonly number[]): number {
  return piles.reduce((acc, n) => acc ^ n, 0);
}

/**
 * The game-theoretically optimal move for whoever is to move in `state`:
 * - If the Nim-sum is nonzero, there is always some pile where reducing it makes the
 *   Nim-sum of all piles zero — handing the opponent a theoretical loss. That move is
 *   returned (the first such pile, in index order).
 * - If the Nim-sum is already zero, every legal move loses against a perfect opponent;
 *   there's no "best" move to prefer, so this takes a single object from the first
 *   nonempty pile (an arbitrary, but always-legal, choice).
 *
 * Pure and deterministic — no search, no randomness. Throws if every pile is empty (the
 * game has already ended; there is no move to make).
 */
export function optimalNimMove(state: NimState): NimMove {
  const { piles } = state;
  const sum = nimSum(piles);
  if (sum !== 0) {
    for (let pile = 0; pile < piles.length; pile++) {
      const size = piles[pile] ?? 0;
      const target = size ^ sum;
      if (target < size) {
        return { pile, count: size - target };
      }
    }
  }
  for (let pile = 0; pile < piles.length; pile++) {
    if ((piles[pile] ?? 0) > 0) {
      return { pile, count: 1 };
    }
  }
  throw new Error("optimalNimMove: no legal moves available (all piles are empty).");
}

/**
 * Picks a move for whichever player is to move in `state`. With probability
 * `blunderRate` (per `getDifficultyConfig("nim", difficulty)`), plays a uniformly random
 * legal move; otherwise plays {@link optimalNimMove}. Hard has `blunderRate` 0, so Hard
 * is always the game-theoretically optimal move — unbeatable whenever the position's
 * Nim-sum already favors it.
 */
export function pickNimMove(
  state: NimState,
  difficulty: Difficulty,
  rng: Rng = Math.random,
): NimMove {
  const moves = nim.legalMoves(state);
  if (moves.length === 0) {
    throw new Error('pickNimMove: no legal moves available for game "nim".');
  }

  const { blunderRate } = nimDifficultyConfig(difficulty);
  if (blunderRate > 0 && rng() < blunderRate) {
    const index = Math.min(Math.floor(rng() * moves.length), moves.length - 1);
    const move = moves[index];
    if (move === undefined) {
      throw new Error("pickNimMove: random move index out of range.");
    }
    return move;
  }

  return optimalNimMove(state);
}

/**
 * Nim's own blunder-rate table. Deliberately separate from `DIFFICULTY_TABLE`'s
 * `maxDepth`-based config (search depth is meaningless here — there's no search), but
 * mirrors its blunder rates so Nim "feels" consistent with the other games at each level.
 */
const NIM_BLUNDER_RATE: Readonly<Record<Difficulty, number>> = {
  easy: 0.75,
  medium: 0.2,
  hard: 0,
};

function nimDifficultyConfig(difficulty: Difficulty): { blunderRate: number } {
  return { blunderRate: NIM_BLUNDER_RATE[difficulty] };
}
