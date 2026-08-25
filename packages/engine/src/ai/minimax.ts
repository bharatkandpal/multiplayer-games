// Generic minimax + alpha-beta search over any `GameModule`. See docs/GAME_LOGIC.md §3.
//
// Pure and deterministic: no I/O, no clock, no randomness. Difficulty-level randomness
// (Easy/Medium blunder rate) is layered on top of `searchBestMove` in the AI runner
// (MPG-008), never here.
//
// 2-player only for now: the search maximizes for whichever player is to move at the
// root and minimizes for their opponent, alternating by `game.currentPlayer` at each
// node. N-player "maxⁿ" search is a future concern (see GameModule.playerCount).

import type { GameModule, Player } from "../types";

/** Magnitude of a terminal win/loss score, before the depth adjustment. */
const WIN_SCORE = 1_000_000;

/**
 * Score of a terminal-or-cutoff `state`, from `rootPlayer`'s perspective.
 * - Win for `rootPlayer`: large positive, preferring faster wins (fewer plies deep).
 * - Loss for `rootPlayer`: large negative, preferring slower losses.
 * - Draw: `0`.
 * - Non-terminal (depth cutoff): the game's own heuristic `evaluate`.
 */
function terminalOrHeuristicScore<S, M>(
  game: GameModule<S, M>,
  state: S,
  rootPlayer: Player,
  depthFromRoot: number,
): number {
  const result = game.getResult(state);
  if (result.status === "win") {
    return result.winner === rootPlayer ? WIN_SCORE - depthFromRoot : -WIN_SCORE + depthFromRoot;
  }
  if (result.status === "draw") {
    return 0;
  }
  // `minimax` only calls this once `result.status !== "in_progress" || depth === 0`,
  // so remaining calls are non-terminal depth cutoffs: fall back to the heuristic.
  return game.evaluate(state, rootPlayer);
}

/**
 * Minimax with alpha-beta pruning, evaluated from `rootPlayer`'s perspective: nodes
 * where `rootPlayer` is to move are maximized, nodes where the opponent is to move are
 * minimized. `game.playerCount` must be 2 (asserted at the `searchBestMove` boundary).
 *
 * @param depth - plies remaining to search before falling back to `game.evaluate`.
 * @param depthFromRoot - plies already played since the root position, used to prefer
 *   faster wins / slower losses in the terminal score. Callers normally omit this.
 */
export function minimax<S, M>(
  game: GameModule<S, M>,
  state: S,
  depth: number,
  alpha: number,
  beta: number,
  rootPlayer: Player,
  depthFromRoot = 0,
): number {
  const result = game.getResult(state);
  if (result.status !== "in_progress" || depth === 0) {
    return terminalOrHeuristicScore(game, state, rootPlayer, depthFromRoot);
  }

  const moves = game.legalMoves(state);
  const orderedMoves = game.orderMoves?.(state, moves) ?? moves;
  const mover = game.currentPlayer(state);
  const maximizing = mover === rootPlayer;

  let best = maximizing ? -Infinity : Infinity;
  let a = alpha;
  let b = beta;

  for (const move of orderedMoves) {
    const next = game.applyMove(state, move, mover);
    const score = minimax(game, next, depth - 1, a, b, rootPlayer, depthFromRoot + 1);
    if (maximizing) {
      best = Math.max(best, score);
      a = Math.max(a, best);
    } else {
      best = Math.min(best, score);
      b = Math.min(b, best);
    }
    if (a >= b) break; // alpha-beta prune
  }

  return best;
}

/** Options controlling a {@link searchBestMove} call. */
export interface SearchOptions {
  /** Plies to search before falling back to the game's heuristic `evaluate`. */
  maxDepth: number;
}

/** The outcome of a {@link searchBestMove} call. */
export interface SearchResult<M> {
  /** The best move found for the player to move. */
  move: M;
  /** That move's minimax score, from the mover's perspective. */
  score: number;
}

/**
 * Finds the best move for whichever player is to move in `state`, via minimax with
 * alpha-beta pruning to `options.maxDepth` plies. Deterministic: ties break toward the
 * first best move in `game.orderMoves` (or `game.legalMoves`) iteration order.
 *
 * 2-player only — throws if `game.playerCount !== 2`. Throws if `state` has no legal
 * moves (i.e. the game is already over).
 */
export function searchBestMove<S, M>(
  game: GameModule<S, M>,
  state: S,
  options: SearchOptions,
): SearchResult<M> {
  if (game.playerCount !== 2) {
    throw new Error(
      `searchBestMove only supports 2-player games (got playerCount=${game.playerCount}).`,
    );
  }

  const rootPlayer = game.currentPlayer(state);
  const moves = game.legalMoves(state);
  const orderedMoves = game.orderMoves?.(state, moves) ?? moves;

  if (orderedMoves.length === 0) {
    throw new Error("searchBestMove: no legal moves available from the given state.");
  }

  let alpha = -Infinity;
  const beta = Infinity;

  let bestMove: M | undefined;
  let bestScore = -Infinity;

  for (const move of orderedMoves) {
    const next = game.applyMove(state, move, rootPlayer);
    const score = minimax(game, next, options.maxDepth - 1, alpha, beta, rootPlayer, 1);
    if (bestMove === undefined || score > bestScore) {
      bestScore = score;
      bestMove = move;
      alpha = Math.max(alpha, bestScore);
    }
  }

  // `orderedMoves` is non-empty (checked above), so the loop always assigns `bestMove`.
  return { move: bestMove as M, score: bestScore };
}
