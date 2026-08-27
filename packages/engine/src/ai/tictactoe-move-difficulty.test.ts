// AI strength/behavior tests for the "tictactoe-move" GameModule. See
// docs/GAME_LOGIC.md §4/§6 and difficulty.test.ts (same conventions: every source of
// randomness flows through a seeded PRNG, never Math.random, so every simulated game is
// reproducible).

import { describe, it, expect } from "vitest";
import type { Difficulty, Player } from "../types";
import type { TicTacToeMoveMove, TicTacToeMoveState } from "../tictactoe-move";
import { ticTacToeMove } from "../tictactoe-move";
import { pickMove, getDifficultyConfig } from "./difficulty";
import type { Rng } from "./difficulty";

/**
 * Deterministic PRNG (mulberry32): given the same seed, produces the same sequence of
 * floats in `[0, 1)` every time, in every environment.
 */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Serializes a move for Set-membership / equality checks in legality assertions. */
function moveKey(move: TicTacToeMoveMove): string {
  return move.kind === "place" ? `place:${move.cell}` : `relocate:${move.from}->${move.to}`;
}

/** Plays moves to reach a fully-placed (both sides have 3 pieces down) move-phase state. */
function movePhaseState(): TicTacToeMoveState {
  // X: 0,1,7 ; O: 3,4,6 -- both fully placed, no immediate win, X to move next (relocation).
  let state = ticTacToeMove.createInitialState();
  const placements: readonly { cell: number; player: Player }[] = [
    { cell: 0, player: 1 },
    { cell: 3, player: 2 },
    { cell: 1, player: 1 },
    { cell: 4, player: 2 },
    { cell: 7, player: 1 },
    { cell: 6, player: 2 },
  ];
  for (const { cell, player } of placements) {
    state = ticTacToeMove.applyMove(state, { kind: "place", cell }, player);
  }
  return state;
}

describe("tictactoe-move AI: pickMove legality", () => {
  const difficulties: Difficulty[] = ["easy", "medium", "hard"];

  it.each(difficulties)(
    "pickMove('%s') returns a legal move in the placement phase",
    (difficulty) => {
      const rng = mulberry32(1);
      const state = ticTacToeMove.createInitialState();
      const legal = new Set(ticTacToeMove.legalMoves(state).map(moveKey));
      const move = pickMove(ticTacToeMove, state, difficulty, rng);
      expect(move.kind).toBe("place");
      expect(legal.has(moveKey(move))).toBe(true);
    },
  );

  it.each(difficulties)(
    "pickMove('%s') returns a legal move in the move (relocation) phase",
    (difficulty) => {
      const rng = mulberry32(2);
      const state = movePhaseState();
      const legal = new Set(ticTacToeMove.legalMoves(state).map(moveKey));
      const move = pickMove(ticTacToeMove, state, difficulty, rng);
      expect(move.kind).toBe("relocate");
      expect(legal.has(moveKey(move))).toBe(true);
    },
  );

  it.each(difficulties)(
    "every move returned by pickMove('%s') is legal throughout a full game (both phases)",
    (difficulty) => {
      const rng = mulberry32(2024);
      let state = ticTacToeMove.createInitialState();
      let result = ticTacToeMove.getResult(state);
      let plies = 0;
      const PLY_CAP = 500; // generous: surfaces a bug (e.g. infinite loop) as a failure.
      while (result.status === "in_progress" && plies < PLY_CAP) {
        const mover = ticTacToeMove.currentPlayer(state);
        const legal = new Set(ticTacToeMove.legalMoves(state).map(moveKey));
        const move = pickMove(ticTacToeMove, state, difficulty, rng);
        expect(legal.has(moveKey(move))).toBe(true);
        state = ticTacToeMove.applyMove(state, move, mover);
        result = ticTacToeMove.getResult(state);
        plies++;
      }
      expect(result.status).not.toBe("in_progress");
      expect(plies).toBeLessThan(PLY_CAP);
    },
  );

  it("throws when pickMove is called on a terminal state (no legal moves)", () => {
    // X: 0,1 ; O: 3,4 ; X completes row 0 at cell 2.
    let state = ticTacToeMove.createInitialState();
    state = ticTacToeMove.applyMove(state, { kind: "place", cell: 0 }, 1);
    state = ticTacToeMove.applyMove(state, { kind: "place", cell: 3 }, 2);
    state = ticTacToeMove.applyMove(state, { kind: "place", cell: 1 }, 1);
    state = ticTacToeMove.applyMove(state, { kind: "place", cell: 4 }, 2);
    state = ticTacToeMove.applyMove(state, { kind: "place", cell: 2 }, 1); // X wins.
    expect(ticTacToeMove.getResult(state).status).toBe("win");
    expect(() => pickMove(ticTacToeMove, state, "hard", mulberry32(1))).toThrow(/no legal moves/i);
  });
});

describe("tictactoe-move AI: hard-vs-hard self-play terminates", () => {
  it("a deterministic Hard-vs-Hard game (blunderRate 0) ends in a win or a repetition draw within a bounded ply count", () => {
    const rng = mulberry32(42); // unused for Hard (blunderRate 0), kept for pickMove's signature.
    let state = ticTacToeMove.createInitialState();
    let result = ticTacToeMove.getResult(state);
    const PLY_CAP = 500; // finite position space + determinism guarantee termination well before this.
    let plies = 0;
    while (result.status === "in_progress" && plies < PLY_CAP) {
      const mover = ticTacToeMove.currentPlayer(state);
      const move = pickMove(ticTacToeMove, state, "hard", rng);
      state = ticTacToeMove.applyMove(state, move, mover);
      result = ticTacToeMove.getResult(state);
      plies++;
    }
    expect(plies).toBeLessThan(PLY_CAP);
    expect(["win", "draw"]).toContain(result.status);
  });
});

describe("tictactoe-move AI: difficulty gradient", () => {
  type Outcome = "a_win" | "b_win" | "draw";

  /** Plays one game between two difficulty policies; `firstMover` picks which policy moves first. */
  function playGame(
    policyA: Difficulty,
    policyB: Difficulty,
    rng: Rng,
    firstMover: "a" | "b",
  ): Outcome {
    let state = ticTacToeMove.createInitialState();
    const policyForSeat: Record<Player, Difficulty> =
      firstMover === "a" ? { 1: policyA, 2: policyB } : { 1: policyB, 2: policyA };

    let result = ticTacToeMove.getResult(state);
    let plies = 0;
    const PLY_CAP = 500;
    while (result.status === "in_progress" && plies < PLY_CAP) {
      const mover = ticTacToeMove.currentPlayer(state);
      const difficulty = policyForSeat[mover];
      if (difficulty === undefined) {
        throw new Error(`playGame: no policy configured for seat ${mover}.`);
      }
      const move = pickMove(ticTacToeMove, state, difficulty, rng);
      state = ticTacToeMove.applyMove(state, move, mover);
      result = ticTacToeMove.getResult(state);
      plies++;
    }
    if (result.status !== "win") return "draw";
    const aSeat = firstMover === "a" ? 1 : 2;
    return result.winner === aSeat ? "a_win" : "b_win";
  }

  it("Hard never loses to Easy or Medium across seeded games", () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const opponent of ["easy", "medium"] as const) {
      for (const firstMover of ["a", "b"] as const) {
        for (const seed of seeds) {
          const outcome = playGame("hard", opponent, mulberry32(seed), firstMover);
          expect(outcome).not.toBe("b_win");
        }
      }
    }
  });

  it("Hard scores >= Medium scores >= Easy scores against a common Easy opponent", () => {
    const TOLERANCE = 0.05;
    const games = 20;

    function scoreAgainstEasy(difficulty: Difficulty): number {
      let score = 0;
      for (let seed = 1; seed <= games; seed++) {
        for (const firstMover of ["a", "b"] as const) {
          const rng = mulberry32(seed * 7919 + (firstMover === "a" ? 0 : 1));
          const outcome = playGame(difficulty, "easy", rng, firstMover);
          if (outcome === "a_win") score += 1;
          else if (outcome === "draw") score += 0.5;
        }
      }
      return score / (games * 2);
    }

    const hardScore = scoreAgainstEasy("hard");
    const mediumScore = scoreAgainstEasy("medium");
    const easyScore = scoreAgainstEasy("easy"); // Easy vs Easy: ~0.5 by symmetry.

    expect(hardScore).toBeGreaterThanOrEqual(mediumScore - TOLERANCE);
    expect(mediumScore).toBeGreaterThanOrEqual(easyScore - TOLERANCE);
  });
});

describe("tictactoe-move AI: config sanity", () => {
  it("Hard has blunderRate 0 and a deeper search than Medium/Easy", () => {
    const easy = getDifficultyConfig("tictactoe-move", "easy");
    const medium = getDifficultyConfig("tictactoe-move", "medium");
    const hard = getDifficultyConfig("tictactoe-move", "hard");

    expect(hard.blunderRate).toBe(0);
    expect(medium.maxDepth).toBeGreaterThanOrEqual(easy.maxDepth);
    expect(hard.maxDepth).toBeGreaterThanOrEqual(medium.maxDepth);
    expect(medium.blunderRate).toBeLessThanOrEqual(easy.blunderRate);
    expect(hard.blunderRate).toBeLessThanOrEqual(medium.blunderRate);
  });
});

describe("tictactoe-move AI: move computed within the time budget", () => {
  it("Hard computes a move within 500ms from the opening", () => {
    const state = ticTacToeMove.createInitialState();
    const rng = mulberry32(1);
    const start = Date.now();
    const move = pickMove(ticTacToeMove, state, "hard", rng);
    const elapsed = Date.now() - start;

    const legal = new Set(ticTacToeMove.legalMoves(state).map(moveKey));
    expect(legal.has(moveKey(move))).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });

  it("Hard computes a move within 500ms from a move-phase (relocation) position", () => {
    const state = movePhaseState();
    const rng = mulberry32(1);
    const start = Date.now();
    const move = pickMove(ticTacToeMove, state, "hard", rng);
    const elapsed = Date.now() - start;

    const legal = new Set(ticTacToeMove.legalMoves(state).map(moveKey));
    expect(legal.has(moveKey(move))).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
