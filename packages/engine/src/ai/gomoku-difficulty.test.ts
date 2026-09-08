// AI strength/behavior tests for the Gomoku GameModule (MPG-107). Same conventions as
// tictactoe-move-difficulty.test.ts: all randomness flows through a seeded PRNG (never
// Math.random), so every simulated game is reproducible.

import { describe, it, expect } from "vitest";
import type { Difficulty, Player } from "../types";
import type { GomokuMove } from "../gomoku";
import { gomoku } from "../gomoku";
import { pickMove, getDifficultyConfig } from "./difficulty";
import type { Rng } from "./difficulty";

/** Deterministic PRNG (mulberry32) — same seed, same sequence, everywhere. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function moveKey(move: GomokuMove): string {
  return `${move.row},${move.col}`;
}

/** The <500ms per-move budget from the PRD NFR, asserted directly below. */
const MOVE_BUDGET_MS = 500;

type Outcome = "a_win" | "b_win" | "draw";

/** Plays one full game between two policies; `firstMover` picks which policy is seat 1. */
function playGame(
  policyA: Difficulty,
  policyB: Difficulty,
  rng: Rng,
  firstMover: "a" | "b",
): Outcome {
  let state = gomoku.createInitialState();
  const policyForSeat: Record<Player, Difficulty> =
    firstMover === "a" ? { 1: policyA, 2: policyB } : { 1: policyB, 2: policyA };

  let result = gomoku.getResult(state);
  // 81 cells is a hard upper bound on ply count; the cap only guards a rules regression.
  const PLY_CAP = 81;
  let plies = 0;
  while (result.status === "in_progress" && plies < PLY_CAP) {
    const mover = gomoku.currentPlayer(state);
    const difficulty = policyForSeat[mover];
    if (difficulty === undefined) {
      throw new Error(`playGame: no policy configured for seat ${mover}.`);
    }
    state = gomoku.applyMove(state, pickMove(gomoku, state, difficulty, rng), mover);
    result = gomoku.getResult(state);
    plies++;
  }
  if (result.status !== "win") return "draw";
  const aSeat = firstMover === "a" ? 1 : 2;
  return result.winner === aSeat ? "a_win" : "b_win";
}

/** A policy that always plays a uniformly random legal move. */
function randomMove(state: ReturnType<typeof gomoku.createInitialState>, rng: Rng): GomokuMove {
  const moves = gomoku.legalMoves(state);
  const move = moves[Math.min(Math.floor(rng() * moves.length), moves.length - 1)];
  if (move === undefined) throw new Error("randomMove: no legal moves.");
  return move;
}

describe("gomoku AI: pickMove legality", () => {
  const difficulties: Difficulty[] = ["easy", "medium", "hard"];

  it.each(difficulties)("pickMove('%s') returns a legal move from the opening", (difficulty) => {
    const state = gomoku.createInitialState();
    const legal = new Set(gomoku.legalMoves(state).map(moveKey));
    const move = pickMove(gomoku, state, difficulty, mulberry32(1));
    expect(legal.has(moveKey(move))).toBe(true);
  });

  it.each(difficulties)("pickMove('%s') returns a legal move mid-game", (difficulty) => {
    let state = gomoku.createInitialState();
    const opening: GomokuMove[] = [
      { row: 4, col: 4 },
      { row: 3, col: 4 },
      { row: 4, col: 5 },
      { row: 3, col: 5 },
    ];
    opening.forEach((move, index) => {
      state = gomoku.applyMove(state, move, index % 2 === 0 ? 1 : 2);
    });
    const legal = new Set(gomoku.legalMoves(state).map(moveKey));
    const move = pickMove(gomoku, state, difficulty, mulberry32(2));
    expect(legal.has(moveKey(move))).toBe(true);
  });
});

describe("gomoku AI: tactics", () => {
  it("Hard completes its own open four rather than anything else", () => {
    // Player 1 to move with `.1111.` on row 4 — completing at either end wins outright.
    let state = gomoku.createInitialState();
    const setup: { move: GomokuMove; player: Player }[] = [
      { move: { row: 4, col: 2 }, player: 1 },
      { move: { row: 0, col: 0 }, player: 2 },
      { move: { row: 4, col: 3 }, player: 1 },
      { move: { row: 0, col: 1 }, player: 2 },
      { move: { row: 4, col: 4 }, player: 1 },
      { move: { row: 0, col: 2 }, player: 2 },
      { move: { row: 4, col: 5 }, player: 1 },
      { move: { row: 8, col: 8 }, player: 2 },
    ];
    for (const { move, player } of setup) state = gomoku.applyMove(state, move, player);

    const move = pickMove(gomoku, state, "hard", mulberry32(3));
    const winning = new Set([moveKey({ row: 4, col: 1 }), moveKey({ row: 4, col: 6 })]);
    expect(winning.has(moveKey(move))).toBe(true);

    const after = gomoku.applyMove(state, move, 1);
    expect(gomoku.getResult(after).status).toBe("win");
  });

  it("Hard blocks the opponent's four at its single open end", () => {
    // Player 1 to move against `12222.` on row 4: player 1 already holds (4,1), so (4,6)
    // is the ONLY cell that completes player 2's five — and the only move that does not
    // lose on the spot. Deliberately a *closed* four: an open four (`.2222.`) is by
    // definition unstoppable, so every reply loses and the bot rightly has no preference.
    let state = gomoku.createInitialState();
    const setup: { move: GomokuMove; player: Player }[] = [
      { move: { row: 4, col: 1 }, player: 1 },
      { move: { row: 4, col: 2 }, player: 2 },
      { move: { row: 0, col: 0 }, player: 1 },
      { move: { row: 4, col: 3 }, player: 2 },
      { move: { row: 0, col: 2 }, player: 1 },
      { move: { row: 4, col: 4 }, player: 2 },
      { move: { row: 8, col: 8 }, player: 1 },
      { move: { row: 4, col: 5 }, player: 2 },
    ];
    for (const { move, player } of setup) state = gomoku.applyMove(state, move, player);
    expect(gomoku.currentPlayer(state)).toBe(1);

    const move = pickMove(gomoku, state, "hard", mulberry32(4));
    expect(moveKey(move)).toBe(moveKey({ row: 4, col: 6 }));
  });
});

// These two tests simulate whole games at Hard's depth 5, which is far slower than any
// single-move test here. Vitest's default 5s timeout is not enough on CI hardware (it is
// locally), so both get an explicit, generous budget — this is simulation cost, NOT a
// statement about per-move speed, which the <500ms tests below assert separately.
const SIMULATION_TIMEOUT_MS = 120_000;

describe("gomoku AI: difficulty gradient", () => {
  it(
    "Hard beats a random player on every seeded game, from either seat",
    () => {
      for (const hardSeat of [1, 2] as const) {
        for (const seed of [1, 2]) {
          const rng = mulberry32(seed);
          let state = gomoku.createInitialState();
          let result = gomoku.getResult(state);
          let plies = 0;
          while (result.status === "in_progress" && plies < 81) {
            const mover = gomoku.currentPlayer(state);
            const move =
              mover === hardSeat ? pickMove(gomoku, state, "hard", rng) : randomMove(state, rng);
            state = gomoku.applyMove(state, move, mover);
            result = gomoku.getResult(state);
            plies++;
          }
          expect(result.status).toBe("win");
          if (result.status !== "win") return;
          expect(result.winner).toBe(hardSeat);
        }
      }
    },
    SIMULATION_TIMEOUT_MS,
  );

  it(
    "Hard scores >= Medium >= Easy against a common Easy opponent",
    () => {
      const TOLERANCE = 0.05;
      const seeds = [1, 2];

      function scoreAgainstEasy(difficulty: Difficulty): number {
        let score = 0;
        for (const seed of seeds) {
          for (const firstMover of ["a", "b"] as const) {
            const rng = mulberry32(seed * 7919 + (firstMover === "a" ? 0 : 1));
            const outcome = playGame(difficulty, "easy", rng, firstMover);
            if (outcome === "a_win") score += 1;
            else if (outcome === "draw") score += 0.5;
          }
        }
        return score / (seeds.length * 2);
      }

      const hard = scoreAgainstEasy("hard");
      const medium = scoreAgainstEasy("medium");
      const easy = scoreAgainstEasy("easy"); // ~0.5 by symmetry.

      expect(hard).toBeGreaterThanOrEqual(medium - TOLERANCE);
      expect(medium).toBeGreaterThanOrEqual(easy - TOLERANCE);
    },
    SIMULATION_TIMEOUT_MS,
  );
});

describe("gomoku AI: config sanity", () => {
  it("Hard never blunders and searches at least as deep as Medium/Easy", () => {
    const easy = getDifficultyConfig("gomoku", "easy");
    const medium = getDifficultyConfig("gomoku", "medium");
    const hard = getDifficultyConfig("gomoku", "hard");

    expect(hard.blunderRate).toBe(0);
    expect(medium.maxDepth).toBeGreaterThanOrEqual(easy.maxDepth);
    expect(hard.maxDepth).toBeGreaterThanOrEqual(medium.maxDepth);
    expect(medium.blunderRate).toBeLessThanOrEqual(easy.blunderRate);
    expect(hard.blunderRate).toBeLessThanOrEqual(medium.blunderRate);
  });

  it("has a bespoke table entry rather than the generic fallback", () => {
    // Regression guard for MPG-107: DEFAULT_DIFFICULTY's depth 6 measured >1s/move here,
    // so silently falling back would reintroduce an over-budget Hard bot.
    expect(getDifficultyConfig("gomoku", "hard").maxDepth).toBeLessThan(6);
  });
});

describe("gomoku AI: move computed within the time budget", () => {
  it("Hard moves within 500ms from the opening", () => {
    const state = gomoku.createInitialState();
    const start = Date.now();
    pickMove(gomoku, state, "hard", mulberry32(1));
    expect(Date.now() - start).toBeLessThan(MOVE_BUDGET_MS);
  });

  it(
    "Hard stays within 500ms per move across a full self-played game",
    () => {
      // The opening is cheap; the expensive positions are mid-game, once many stones are
      // on the board and the candidate set is at its widest. Times every single move.
      // The per-move assertion is the point; the whole-game wall clock is necessarily
      // many times MOVE_BUDGET_MS, hence the explicit test timeout.
      let state = gomoku.createInitialState();
      const rng = mulberry32(5);
      let worst = 0;
      let plies = 0;
      while (gomoku.getResult(state).status === "in_progress" && plies < 81) {
        const mover = gomoku.currentPlayer(state);
        const start = Date.now();
        const move = pickMove(gomoku, state, "hard", rng);
        worst = Math.max(worst, Date.now() - start);
        state = gomoku.applyMove(state, move, mover);
        plies++;
      }
      expect(worst).toBeLessThan(MOVE_BUDGET_MS);
    },
    SIMULATION_TIMEOUT_MS,
  );
});
