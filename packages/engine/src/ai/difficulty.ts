// Difficulty policy + stateless AI move picker. See docs/GAME_LOGIC.md §4-5.
//
// Pure and deterministic given a fixed `rng`: the only nondeterminism anywhere in the
// AI layer is the injected `Rng`, never `Math.random()` called directly (that's only
// the caller-facing default). Search itself (`searchBestMove`) is fully deterministic;
// difficulty is layered on top as a search-depth cap plus a "blunder rate" — the
// probability of playing a uniformly random legal move instead of the minimax choice.

import { searchBestMove } from "./minimax";
import type { Difficulty, GameId, GameModule } from "../types";

/** A source of randomness, returning a float in `[0, 1)` — same contract as `Math.random`. */
export type Rng = () => number;

/** Search depth + blunder rate for one (game, difficulty) pair. */
export interface DifficultyConfig {
  /** Plies to search via minimax before falling back to the heuristic `evaluate`. */
  readonly maxDepth: number;
  /**
   * Probability `[0, 1]` of playing a uniformly random legal move instead of the
   * minimax-best move. `0` for Hard — Hard never blunders.
   */
  readonly blunderRate: number;
}

type PerDifficulty = Readonly<Record<Difficulty, DifficultyConfig>>;

/**
 * Fallback difficulty table for any `GameId` without a bespoke entry below (future
 * games/plugins). Depth 4 is a reasonable general-purpose search budget; blunder rates
 * mirror the Tic-Tac-Toe tuning as a conservative default.
 */
export const DEFAULT_DIFFICULTY: PerDifficulty = {
  easy: { maxDepth: 1, blunderRate: 0.7 },
  medium: { maxDepth: 4, blunderRate: 0.15 },
  hard: { maxDepth: 6, blunderRate: 0 },
};

/** Per-game difficulty tables, tuned per docs/GAME_LOGIC.md §4. */
export const DIFFICULTY_TABLE: Readonly<Partial<Record<GameId, PerDifficulty>>> = {
  tictactoe: {
    easy: { maxDepth: 1, blunderRate: 0.7 },
    medium: { maxDepth: 4, blunderRate: 0.15 },
    // Tic-Tac-Toe's tree is tiny (≤9 plies): depth 9 is a full, unbounded search, so
    // Hard is provably never-losing.
    hard: { maxDepth: 9, blunderRate: 0 },
  },
  connect4: {
    easy: { maxDepth: 2, blunderRate: 0.4 },
    medium: { maxDepth: 5, blunderRate: 0.1 },
    // Bounded by the <500ms move-time budget (PRD NFR); depth 7 + alpha-beta + center
    // -first move ordering comfortably fits that budget.
    hard: { maxDepth: 7, blunderRate: 0 },
  },
  "tictactoe-move": {
    easy: { maxDepth: 1, blunderRate: 0.7 },
    medium: { maxDepth: 4, blunderRate: 0.15 },
    // Unlike classic Tic-Tac-Toe, this game's branching factor doesn't shrink toward the
    // end (a relocation always has ~9 cells occupied / 9-occupied empty, so move-phase
    // branching stays roughly (3 own pieces x 3 empty cells) = up to 9 throughout, and
    // games can run long before a threefold-repetition draw), so a full-depth/unbounded
    // search isn't practical the way it is for classic TTT. `tictactoe-move.ts`'s
    // `orderMoves` (1-ply lookahead, best-score-first) makes alpha-beta pruning highly
    // effective here: measured worst-case over many simulated hard-vs-hard games, depth 8
    // took <40ms/move, and even depth 12 stayed under ~450ms/move — so depth 8 leaves a
    // large safety margin under the <500ms budget (PRD NFR) on slower hardware/CI while
    // already searching deep enough to see multi-move tactics in both phases.
    hard: { maxDepth: 8, blunderRate: 0 },
  },
  // Nim routes through this generic minimax-backed `pickMove` like every other game —
  // there is no per-game AI dispatch layer yet, so `ai/heuristics/nim.ts`'s closed-form
  // Nim-sum solver (`pickNimMove`) is not currently on this path; it's exported for a
  // future per-game dispatch layer (see MPG-072 follow-up). `nim.evaluate` returns the
  // *exact* game-theoretic value (win/loss is fully determined by the nim-sum), so
  // minimax needs only depth 1 to play optimally — deeper search buys nothing and cost
  // ~1.7s/move at depth 16 (well over the <500ms budget). Medium blunders 20% of the
  // time off that same depth-1-optimal line; Easy blunders 75%.
  nim: {
    easy: { maxDepth: 1, blunderRate: 0.75 },
    medium: { maxDepth: 1, blunderRate: 0.2 },
    hard: { maxDepth: 1, blunderRate: 0 },
  },
  // Gomoku needs a bespoke entry because DEFAULT_DIFFICULTY's depth 6 does NOT fit the
  // <500ms budget here (MPG-107): measured over 14 self-play positions, depth 6 peaked at
  // ~1025ms/move (and 634ms in real Hard play from the opening), while depth 5 peaked at
  // ~124ms and depth 4 at ~38ms. Hard is therefore depth 5 — roughly 4x under budget, the
  // margin that keeps slower CI/hardware safe, matching the tictactoe-move reasoning above.
  // What makes even depth 5 affordable is `gomoku.orderMoves`, which restricts the search
  // to <=12 candidate cells near existing stones rather than all 81 (see gomoku.ts); the
  // depth here is only meaningful in combination with that restriction.
  gomoku: {
    easy: { maxDepth: 1, blunderRate: 0.7 },
    medium: { maxDepth: 3, blunderRate: 0.15 },
    hard: { maxDepth: 5, blunderRate: 0 },
  },
};

/** Looks up the tuned `{maxDepth, blunderRate}` for `gameId` + `difficulty`, falling back
 * to {@link DEFAULT_DIFFICULTY} for games without a bespoke entry. */
export function getDifficultyConfig(gameId: GameId, difficulty: Difficulty): DifficultyConfig {
  const perGame = DIFFICULTY_TABLE[gameId];
  return perGame?.[difficulty] ?? DEFAULT_DIFFICULTY[difficulty];
}

/**
 * Picks a move for whichever player is to move in `state`, per `difficulty`'s search
 * depth and blunder rate. Stateless and pure aside from the injected `rng`: given a
 * fixed `rng`, `pickMove` is fully deterministic (useful for reproducible tests/replays).
 *
 * With probability `blunderRate`, returns a uniformly random legal move; otherwise
 * returns the minimax-best move from `searchBestMove`. Throws if `state` has no legal
 * moves (the game is already over).
 */
export function pickMove<S, M>(
  game: GameModule<S, M>,
  state: S,
  difficulty: Difficulty,
  rng: Rng = Math.random,
): M {
  const moves = game.legalMoves(state);
  if (moves.length === 0) {
    throw new Error(`pickMove: no legal moves available for game "${game.id}".`);
  }

  const { maxDepth, blunderRate } = getDifficultyConfig(game.id, difficulty);

  if (blunderRate > 0 && rng() < blunderRate) {
    const index = Math.min(Math.floor(rng() * moves.length), moves.length - 1);
    const move = moves[index];
    if (move === undefined) {
      // Unreachable given the length check above; guards `noUncheckedIndexedAccess`.
      throw new Error("pickMove: random move index out of range.");
    }
    return move;
  }

  return searchBestMove(game, state, { maxDepth }).move;
}
