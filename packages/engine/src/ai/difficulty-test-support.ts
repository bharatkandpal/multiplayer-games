// Shared, non-test helpers for the difficulty-policy strength suites. Split out (MPG-151)
// so difficulty.test.ts (cheap, runs on every `test:fast`/pre-push) and
// difficulty.exhaustive.test.ts (the full depth-7 sweep, dispatch-only via the `Verify`
// workflow) can both exercise the *same* simulation logic against different sample sizes
// — the split is purely about how many seeded games each file plays, never about the game
// logic itself. Not a `.test.ts` file, so Vitest never collects it as its own suite.
//
// All randomness flows through the injected `Rng` (mulberry32 below) — never
// `Math.random` — so every simulated game is reproducible from its seed alone.

import type { GameModule, Difficulty, Player } from "../types";
import { ticTacToe } from "../tictactoe";
import { connectFour } from "../connect4";
import { pickMove } from "./difficulty";
import type { Rng } from "./difficulty";

/**
 * Deterministic PRNG (mulberry32): given the same seed, produces the same sequence of
 * floats in `[0, 1)` every time, in every environment. Used instead of `Math.random` for
 * every source of randomness in these suites (blunder rolls and any test-side coin flips).
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Outcome of a single simulated game, from `playerA`'s perspective (seat 1). */
export type GameOutcome = "a_win" | "b_win" | "draw";

/**
 * Plays one full game between two difficulty "policies" using a single shared seeded
 * `rng` (so the whole game is reproducible from the seed alone). `firstMover` picks
 * whether policy A or B occupies seat 1 (moves first).
 */
export function playGame<S, M>(
  game: GameModule<S, M>,
  policyA: Difficulty,
  policyB: Difficulty,
  rng: Rng,
  firstMover: "a" | "b" = "a",
): GameOutcome {
  let state = game.createInitialState();
  // seat 1 (moves first) <-> policy; seat 2 <-> the other policy.
  const policyForSeat: Record<Player, Difficulty> =
    firstMover === "a" ? { 1: policyA, 2: policyB } : { 1: policyB, 2: policyA };

  let result = game.getResult(state);
  while (result.status === "in_progress") {
    const mover = game.currentPlayer(state);
    const difficulty = policyForSeat[mover];
    if (difficulty === undefined) {
      throw new Error(`playGame: no policy configured for seat ${mover}.`);
    }
    const move = pickMove(game, state, difficulty, rng);
    state = game.applyMove(state, move, mover);
    result = game.getResult(state);
  }

  if (result.status === "draw") return "draw";
  const aSeat = firstMover === "a" ? 1 : 2;
  return result.winner === aSeat ? "a_win" : "b_win";
}

/** Uniformly random legal move via `rng`, used to stand in for a "random" opponent. */
export function randomLegalMove<S, M>(game: GameModule<S, M>, state: S, rng: Rng): M {
  const moves = game.legalMoves(state);
  const index = Math.min(Math.floor(rng() * moves.length), moves.length - 1);
  const move = moves[index];
  if (move === undefined) throw new Error("randomLegalMove: index out of range.");
  return move;
}

/** Plays Hard (depth 7) against a uniformly random opponent; "random" picks a legal move
 * each turn via the shared seeded `rng`, independent of `pickMove`'s own blunder logic. */
export function playHardVsRandom(rng: Rng, hardFirst: boolean): GameOutcome {
  let state = connectFour.createInitialState();
  let result = connectFour.getResult(state);
  const hardSeat = hardFirst ? 1 : 2;
  while (result.status === "in_progress") {
    const mover = connectFour.currentPlayer(state);
    const move =
      mover === hardSeat
        ? pickMove(connectFour, state, "hard", rng)
        : randomLegalMove(connectFour, state, rng);
    state = connectFour.applyMove(state, move, mover);
    result = connectFour.getResult(state);
  }
  if (result.status === "draw") return "draw";
  return result.winner === hardSeat ? "a_win" : "b_win";
}

/**
 * Runs `gamesPerSide` seeded Hard-vs-random Connect Four games with Hard moving first,
 * plus `gamesPerSide` more with Hard moving second (seeds `1..gamesPerSide`, disjoint
 * seed space per side), and returns the fraction Hard won. Used at a small `gamesPerSide`
 * for the cheap per-push check and a larger one for the full exhaustive sweep.
 */
export function hardVsRandomWinRate(gamesPerSide: number): number {
  let wins = 0;
  let total = 0;
  for (let seed = 1; seed <= gamesPerSide; seed++) {
    for (const hardFirst of [true, false]) {
      const rng = mulberry32(seed * 1000 + (hardFirst ? 1 : 0));
      const outcome = playHardVsRandom(rng, hardFirst);
      if (outcome === "a_win") wins++;
      total++;
    }
  }
  return wins / total;
}

/** Score = wins + 0.5*draws (out of `games`) for Connect Four `difficulty` against Easy,
 * over seeded games with both sides taking a turn moving first. */
export function scoreC4AgainstEasy(difficulty: Difficulty, games: number): number {
  let score = 0;
  for (let seed = 1; seed <= games; seed++) {
    for (const firstMover of ["a", "b"] as const) {
      const rng = mulberry32(seed * 104729 + (firstMover === "a" ? 0 : 1));
      const outcome = playGame(connectFour, difficulty, "easy", rng, firstMover);
      if (outcome === "a_win") score += 1;
      else if (outcome === "draw") score += 0.5;
    }
  }
  return score / (games * 2);
}

/** Score = wins + 0.5*draws (out of `games`) for Tic-Tac-Toe `difficulty` against Easy,
 * over seeded games with both sides taking a turn moving first. */
export function scoreTTTAgainstEasy(difficulty: Difficulty, games: number): number {
  let score = 0;
  for (let seed = 1; seed <= games; seed++) {
    for (const firstMover of ["a", "b"] as const) {
      const rng = mulberry32(seed * 7919 + (firstMover === "a" ? 0 : 1));
      const outcome = playGame(ticTacToe, difficulty, "easy", rng, firstMover);
      if (outcome === "a_win") score += 1;
      else if (outcome === "draw") score += 0.5;
    }
  }
  return score / (games * 2);
}

/** Tolerance for monotonicity assertions: Medium/Easy are themselves randomized, so a
 * single sample of N games is a noisy estimator; the inequality should still hold
 * clearly given a rate difference this large. */
export const MONOTONIC_TOLERANCE = 0.05;
