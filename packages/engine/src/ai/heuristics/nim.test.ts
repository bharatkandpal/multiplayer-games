// AI strength/behavior tests for Nim's Nim-sum-based picker. See docs/GAME_LOGIC.md §4/§6
// and difficulty.test.ts (same conventions: every source of randomness flows through a
// seeded PRNG, never Math.random, so every simulated game is reproducible).

import { describe, it, expect } from "vitest";
import type { Difficulty, Player } from "../../types";
import type { NimMove, NimState } from "../../nim";
import { nim } from "../../nim";
import type { Rng } from "../difficulty";
import { nimSum, optimalNimMove, pickNimMove } from "./nim";

/** Deterministic PRNG (mulberry32) — same contract used by the rest of the AI test suite. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function moveKey(move: NimMove): string {
  return `${move.pile}:${move.count}`;
}

describe("nim AI: nimSum", () => {
  it("computes the XOR of all pile sizes", () => {
    expect(nimSum([1, 3, 5, 7])).toBe(1 ^ 3 ^ 5 ^ 7);
    expect(nimSum([3, 4, 5])).toBe(3 ^ 4 ^ 5);
    expect(nimSum([0, 0, 0])).toBe(0);
  });
});

describe("nim AI: optimalNimMove", () => {
  it("picks a move that brings the Nim-sum to zero when it is currently nonzero", () => {
    // 3 XOR 4 XOR 5 = 2, nonzero -> a winning move exists.
    const state: NimState = { piles: [3, 4, 5], toMove: 1 };
    expect(nimSum(state.piles)).not.toBe(0);
    const move = optimalNimMove(state);
    const next = state.piles.slice();
    next[move.pile] = (next[move.pile] ?? 0) - move.count;
    expect(nimSum(next)).toBe(0);
  });

  it("returns a legal move even when the Nim-sum is already zero (a theoretical loss)", () => {
    // 1 XOR 3 XOR 5 XOR 7 = 0: no move can restore a zero Nim-sum for the opponent.
    const state: NimState = { piles: [1, 3, 5, 7], toMove: 1 };
    expect(nimSum(state.piles)).toBe(0);
    const move = optimalNimMove(state);
    expect(move.count).toBeGreaterThan(0);
    expect(state.piles[move.pile]).toBeGreaterThanOrEqual(move.count);
  });

  it("throws when every pile is empty", () => {
    expect(() => optimalNimMove({ piles: [0, 0], toMove: 1 })).toThrow(/no legal moves/i);
  });

  it("finds the single-pile equalizing move for a simple two-pile example", () => {
    // Piles [5, 2]: Nim-sum 7 (nonzero). Optimal move reduces pile 0 to 2 (matching pile 1).
    const move = optimalNimMove({ piles: [5, 2], toMove: 1 });
    expect(move).toEqual({ pile: 0, count: 3 });
  });
});

describe("nim AI: pickNimMove legality", () => {
  const difficulties: Difficulty[] = ["easy", "medium", "hard"];

  it.each(difficulties)("pickNimMove('%s') always returns a legal move", (difficulty) => {
    const rng = mulberry32(1);
    let state = nim.createInitialState();
    let result = nim.getResult(state);
    let plies = 0;
    const PLY_CAP = 100;
    while (result.status === "in_progress" && plies < PLY_CAP) {
      const mover = nim.currentPlayer(state);
      const legal = new Set(nim.legalMoves(state).map(moveKey));
      const move = pickNimMove(state, difficulty, rng);
      expect(legal.has(moveKey(move))).toBe(true);
      state = nim.applyMove(state, move, mover);
      result = nim.getResult(state);
      plies++;
    }
    expect(result.status).toBe("win");
    expect(plies).toBeLessThan(PLY_CAP);
  });

  it("throws when called on a terminal state", () => {
    const state: NimState = { piles: [0, 0], toMove: 1 };
    expect(() => pickNimMove(state, "hard", mulberry32(1))).toThrow(/no legal moves/i);
  });
});

describe("nim AI: Hard is unbeatable from a position with a nonzero Nim-sum", () => {
  /** Plays Hard-as-player-1 against `opponent` (as player 2) from a custom start. */
  function playFrom(
    piles: readonly number[],
    opponent: (state: NimState, mover: Player, rng: Rng) => NimMove,
    rng: Rng,
  ): Player {
    let state: NimState = { piles: piles.slice(), toMove: 1 };
    let result = nim.getResult(state);
    while (result.status === "in_progress") {
      const mover = nim.currentPlayer(state);
      const move = mover === 1 ? pickNimMove(state, "hard", rng) : opponent(state, mover, rng);
      state = nim.applyMove(state, move, mover);
      result = nim.getResult(state);
    }
    if (result.status !== "win") throw new Error("nim: expected a decisive result");
    return result.winner;
  }

  it("Hard (player 1) always wins from a nonzero Nim-sum start, even against a perfect opponent", () => {
    // [3, 4, 5]: Nim-sum 2, a winning position for whoever moves first (Hard).
    const winner = playFrom([3, 4, 5], (state) => optimalNimMove(state), mulberry32(1));
    expect(winner).toBe(1);
  });

  it("Hard (player 1) always wins from a nonzero Nim-sum start against a random opponent, across many seeds", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed);
      const winner = playFrom(
        [3, 4, 5],
        (state, _mover, r) => {
          const moves = nim.legalMoves(state);
          const index = Math.min(Math.floor(r() * moves.length), moves.length - 1);
          const move = moves[index];
          if (move === undefined) throw new Error("unreachable: no legal moves");
          return move;
        },
        rng,
      );
      expect(winner).toBe(1);
    }
  });
});

describe("nim AI: Hard beats random play overwhelmingly", () => {
  function randomMove(state: NimState, rng: Rng): NimMove {
    const moves = nim.legalMoves(state);
    const index = Math.min(Math.floor(rng() * moves.length), moves.length - 1);
    const move = moves[index];
    if (move === undefined) throw new Error("unreachable: no legal moves");
    return move;
  }

  function playHardVsRandom(rng: Rng, hardSeat: Player): Player {
    let state = nim.createInitialState();
    let result = nim.getResult(state);
    while (result.status === "in_progress") {
      const mover = nim.currentPlayer(state);
      const move = mover === hardSeat ? pickNimMove(state, "hard", rng) : randomMove(state, rng);
      state = nim.applyMove(state, move, mover);
      result = nim.getResult(state);
    }
    if (result.status !== "win") throw new Error("nim: expected a decisive result");
    return result.winner;
  }

  it("Hard wins >= 95% of games against a random opponent (both seats tried)", () => {
    const games = 200;
    let hardWins = 0;
    for (let seed = 1; seed <= games; seed++) {
      const hardSeat: Player = seed % 2 === 0 ? 1 : 2;
      const winner = playHardVsRandom(mulberry32(seed), hardSeat);
      if (winner === hardSeat) hardWins++;
    }
    expect(hardWins / games).toBeGreaterThanOrEqual(0.95);
  });
});

describe("nim AI: difficulty gradient — Hard >= Medium >= Easy", () => {
  // A nonzero Nim-sum ([3,4,5], sum 2) is a forced win for whoever moves *next* — even
  // against a perfect responder, provided they never blunder. A zero Nim-sum ([1,3,5,7],
  // the built-in default) is the mirror image: a forced win for whoever moves *second*.
  // Nim's own Medium/Easy opponents (unlike Tic-Tac-Toe/Connect Four's shallow-search
  // ones) play the *same* optimal move as Hard whenever they don't blunder — so "Hard
  // never loses" only holds rigorously when Hard is seated on the side that already has
  // the theoretical win, per Bouton's theorem. These tests hold that constant and vary
  // only the opponent's difficulty, matching the spirit of the other games' assertion:
  // an unbeatable Hard never squanders a winning position, at any opponent strength.
  const NONZERO_SUM_START = [3, 4, 5] as const; // advantage: first mover
  const ZERO_SUM_START = [1, 3, 5, 7] as const; // advantage: second mover

  function playGame(
    startPiles: readonly number[],
    policyForSeat: Record<Player, Difficulty>,
    rng: Rng,
  ): Player {
    let state: NimState = { piles: startPiles.slice(), toMove: 1 };
    let result = nim.getResult(state);
    while (result.status === "in_progress") {
      const mover = nim.currentPlayer(state);
      const difficulty = policyForSeat[mover];
      if (difficulty === undefined) throw new Error(`no policy for seat ${mover}`);
      const move = pickNimMove(state, difficulty, rng);
      state = nim.applyMove(state, move, mover);
      result = nim.getResult(state);
    }
    if (result.status !== "win") throw new Error("nim: expected a decisive result");
    return result.winner;
  }

  it("Hard never loses when it holds the winning side, regardless of opponent difficulty", () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const opponent of ["easy", "medium", "hard"] as const) {
      for (const seed of seeds) {
        // Hard moves first from the nonzero-sum (first-mover-advantage) start.
        const firstWinner = playGame(
          NONZERO_SUM_START,
          { 1: "hard", 2: opponent },
          mulberry32(seed),
        );
        expect(firstWinner).toBe(1);

        // Hard moves second from the zero-sum (second-mover-advantage) start.
        const secondWinner = playGame(
          ZERO_SUM_START,
          { 1: opponent, 2: "hard" },
          mulberry32(seed + 1000),
        );
        expect(secondWinner).toBe(2);
      }
    }
  });

  it("Hard's win rate as the advantaged mover >= Medium's >= Easy's, all vs an Easy opponent", () => {
    // Seat 1 always starts from the nonzero-sum (mover-advantage) position, so a
    // flawless player wins 100% of the time; the win rate purely measures how often
    // `difficulty` squanders that advantage via blunders (fewer blunders -> higher rate).
    const games = 60;
    function scoreAsAdvantagedMover(difficulty: Difficulty): number {
      let wins = 0;
      for (let seed = 1; seed <= games; seed++) {
        const rng = mulberry32(seed * 7919);
        const winner = playGame(NONZERO_SUM_START, { 1: difficulty, 2: "easy" }, rng);
        if (winner === 1) wins++;
      }
      return wins / games;
    }

    const hardScore = scoreAsAdvantagedMover("hard");
    const mediumScore = scoreAsAdvantagedMover("medium");
    const easyScore = scoreAsAdvantagedMover("easy");

    expect(hardScore).toBe(1); // Hard never blunders away a forced win.
    const TOLERANCE = 0.05;
    expect(hardScore).toBeGreaterThanOrEqual(mediumScore - TOLERANCE);
    expect(mediumScore).toBeGreaterThanOrEqual(easyScore - TOLERANCE);
  });
});
