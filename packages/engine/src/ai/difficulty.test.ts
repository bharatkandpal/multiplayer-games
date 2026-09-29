// AI strength/behavior tests for the difficulty policy. See docs/GAME_LOGIC.md §4/§6.
//
// All randomness in this file flows through a seeded PRNG (mulberry32) — never
// Math.random — so every simulated game is reproducible. No sleeps: everything here is
// synchronous and driven purely by seeded state.
//
// MPG-151: this file is the cheap, every-pre-push half of the AI strength suite — it
// runs in `test:fast` (and therefore on every `git push`), so every strength claim in
// here uses a small sample sized to fit that budget. The full, larger-sample sweep
// (identical simulation logic, more seeds) lives in difficulty.exhaustive.test.ts, which
// `test:fast` excludes and only `pnpm test` / the dispatch-only `Verify` workflow run.
// Both files share their simulation helpers via difficulty-test-support.ts so the two
// suites can never drift apart in what they're actually testing — only in sample size.

import { describe, it, expect } from "vitest";
import type { TicTacToeMove } from "../tictactoe";
import { ticTacToe } from "../tictactoe";
import type { ConnectFourMove } from "../connect4";
import { connectFour } from "../connect4";
import { pickMove, getDifficultyConfig, DIFFICULTY_TABLE, DEFAULT_DIFFICULTY } from "./difficulty";
import type { Difficulty } from "../types";
import {
  mulberry32,
  playGame,
  hardVsRandomWinRate,
  scoreC4AgainstEasy,
  scoreTTTAgainstEasy,
  MONOTONIC_TOLERANCE,
} from "./difficulty-test-support";

describe("difficulty: TTT Hard never loses", () => {
  const opponents: Difficulty[] = ["hard", "medium", "easy"];
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  it.each(
    opponents.flatMap((opponent) =>
      (["a", "b"] as const).map((firstMover) => ({ opponent, firstMover })),
    ),
  )(
    `Hard vs $opponent (Hard moves as $firstMover) never loses across ${seeds.length} seeds`,
    ({ opponent, firstMover }) => {
      for (const seed of seeds) {
        const rng = mulberry32(seed);
        // `playGame`'s policy args are (policyA, policyB) = ("hard", opponent), always —
        // `firstMover` only controls which seat each policy occupies, so an "a_win"
        // outcome always means Hard (policyA) won, regardless of `firstMover`.
        const outcome = playGame(ticTacToe, "hard", opponent, rng, firstMover);
        // Hard is a full-depth, unbounded search on a solved game: it can never lose,
        // regardless of who it plays or who moves first.
        expect(outcome).not.toBe("b_win");
      }
    },
  );
});

// MPG-151: cheap, every-pre-push sample of the "Hard is actually hard" claim. Runs the
// *same* real "hard" config (depth 7, no shortcuts) as the full sweep — it just samples
// fewer seeded games to fit `test:fast`'s budget (~2s here vs ~13s for the full N=20
// sweep in difficulty.exhaustive.test.ts). Empirically Hard has not lost or drawn a
// single sampled game across 60+ seeds (see the exhaustive file), so requiring zero
// non-wins in this small sample is a real, non-flaky regression guard, not a rubber
// stamp — it just doesn't claim the full >=95%-of-20 statistic on its own.
describe("difficulty: Connect Four Hard beats a random player (cheap per-push smoke check)", () => {
  const gamesPerSide = 3; // 3 with Hard moving first + 3 moving second = 6 total.

  it(`Hard beats a uniformly random opponent every game in this sample (N=${gamesPerSide * 2}); see difficulty.exhaustive.test.ts for the full >=95%-of-20 sweep`, () => {
    expect(hardVsRandomWinRate(gamesPerSide)).toBe(1);
  });
});

describe("difficulty: monotonic strength (Hard >= Medium >= Easy)", () => {
  // Score = wins + 0.5*draws (out of `games`), against a common uniformly-random-ish
  // opponent (here: the weakest tier, Easy, which itself blunders 70%/40% of the time —
  // a stable, cheap common yardstick). We allow a small tolerance since Medium/Easy are
  // themselves randomized, so a single sample of N games is a noisy estimator; the
  // inequality should still hold clearly given a rate difference this large.
  const TOLERANCE = MONOTONIC_TOLERANCE;

  it("TTT: Hard scores >= Medium scores >= Easy scores against Easy, over seeded games", () => {
    const games = 40;
    const hardScore = scoreTTTAgainstEasy("hard", games);
    const mediumScore = scoreTTTAgainstEasy("medium", games);
    const easyScore = scoreTTTAgainstEasy("easy", games); // Easy vs Easy: ~0.5 by symmetry.

    expect(hardScore).toBeGreaterThanOrEqual(mediumScore - TOLERANCE);
    expect(mediumScore).toBeGreaterThanOrEqual(easyScore - TOLERANCE);
  });

  // MPG-151: cheap per-push sample (games=2). The full games=6 version of this same
  // check lives in difficulty.exhaustive.test.ts (dispatch-only `Verify` workflow) —
  // split out because Hard plays every move at depth 7 here, and even this modest N
  // costs a few seconds per difficulty tier.
  it("Connect Four: Hard scores >= Medium scores >= Easy scores against Easy, over seeded games", () => {
    const games = 2;
    const hardScore = scoreC4AgainstEasy("hard", games);
    const mediumScore = scoreC4AgainstEasy("medium", games);
    const easyScore = scoreC4AgainstEasy("easy", games);

    expect(hardScore).toBeGreaterThanOrEqual(mediumScore - TOLERANCE);
    expect(mediumScore).toBeGreaterThanOrEqual(easyScore - TOLERANCE);
  });
});

describe("difficulty: determinism", () => {
  it("pickMove returns the same move on the same state with a fixed seeded rng (TTT)", () => {
    const state = ticTacToe.applyMove(ticTacToe.createInitialState(), { cell: 4 }, 1);
    const seed = 42;
    const first = pickMove(ticTacToe, state, "medium", mulberry32(seed));
    const second = pickMove(ticTacToe, state, "medium", mulberry32(seed));
    const third = pickMove(ticTacToe, state, "medium", mulberry32(seed));
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("pickMove returns the same move on the same state with a fixed seeded rng (Connect Four)", () => {
    const state = connectFour.applyMove(connectFour.createInitialState(), { column: 3 }, 1);
    const seed = 7;
    const first = pickMove(connectFour, state, "easy", mulberry32(seed));
    const second = pickMove(connectFour, state, "easy", mulberry32(seed));
    expect(second).toEqual(first);
  });

  it("a full seeded game replays identically move-for-move (TTT, Easy vs Medium)", () => {
    function replay(seed: number): TicTacToeMove[] {
      const rng = mulberry32(seed);
      const moves: TicTacToeMove[] = [];
      let state = ticTacToe.createInitialState();
      let result = ticTacToe.getResult(state);
      while (result.status === "in_progress") {
        const mover = ticTacToe.currentPlayer(state);
        const difficulty: Difficulty = mover === 1 ? "easy" : "medium";
        const move = pickMove(ticTacToe, state, difficulty, rng);
        moves.push(move);
        state = ticTacToe.applyMove(state, move, mover);
        result = ticTacToe.getResult(state);
      }
      return moves;
    }

    const seed = 99;
    const first = replay(seed);
    const second = replay(seed);
    expect(second).toEqual(first);
  });

  it("a full seeded game replays identically move-for-move (Connect Four, Easy vs Easy)", () => {
    function replay(seed: number): ConnectFourMove[] {
      const rng = mulberry32(seed);
      const moves: ConnectFourMove[] = [];
      let state = connectFour.createInitialState();
      let result = connectFour.getResult(state);
      while (result.status === "in_progress") {
        const mover = connectFour.currentPlayer(state);
        const move = pickMove(connectFour, state, "easy", rng);
        moves.push(move);
        state = connectFour.applyMove(state, move, mover);
        result = connectFour.getResult(state);
      }
      return moves;
    }

    const seed = 314;
    const first = replay(seed);
    const second = replay(seed);
    expect(second).toEqual(first);
  });
});

describe("difficulty: legality", () => {
  const difficulties: Difficulty[] = ["easy", "medium", "hard"];

  it.each(difficulties)(
    "every move returned by pickMove('%s') is legal throughout a full TTT game",
    (difficulty) => {
      const rng = mulberry32(2024);
      let state = ticTacToe.createInitialState();
      let result = ticTacToe.getResult(state);
      while (result.status === "in_progress") {
        const mover = ticTacToe.currentPlayer(state);
        const legal = new Set(ticTacToe.legalMoves(state).map((m) => m.cell));
        const move = pickMove(ticTacToe, state, difficulty, rng);
        expect(legal.has(move.cell)).toBe(true);
        state = ticTacToe.applyMove(state, move, mover);
        result = ticTacToe.getResult(state);
      }
    },
  );

  it.each(difficulties)(
    "every move returned by pickMove('%s') is legal throughout a full Connect Four game",
    (difficulty) => {
      const rng = mulberry32(4096);
      let state = connectFour.createInitialState();
      let result = connectFour.getResult(state);
      while (result.status === "in_progress") {
        const mover = connectFour.currentPlayer(state);
        const legal = new Set(connectFour.legalMoves(state).map((m) => m.column));
        const move = pickMove(connectFour, state, difficulty, rng);
        expect(legal.has(move.column)).toBe(true);
        state = connectFour.applyMove(state, move, mover);
        result = connectFour.getResult(state);
      }
    },
  );

  it("throws when pickMove is called on a terminal state (no legal moves)", () => {
    let state = ticTacToe.createInitialState();
    state = ticTacToe.applyMove(state, { cell: 0 }, 1);
    state = ticTacToe.applyMove(state, { cell: 3 }, 2);
    state = ticTacToe.applyMove(state, { cell: 1 }, 1);
    state = ticTacToe.applyMove(state, { cell: 4 }, 2);
    state = ticTacToe.applyMove(state, { cell: 2 }, 1); // X wins row 0.
    expect(ticTacToe.getResult(state).status).toBe("win");
    expect(() => pickMove(ticTacToe, state, "hard", mulberry32(1))).toThrow(/no legal moves/i);
  });
});

describe("difficulty: config sanity", () => {
  it("Hard has blunderRate 0 for both games", () => {
    expect(getDifficultyConfig("tictactoe", "hard").blunderRate).toBe(0);
    expect(getDifficultyConfig("connect4", "hard").blunderRate).toBe(0);
    expect(DIFFICULTY_TABLE.tictactoe?.hard.blunderRate).toBe(0);
    expect(DIFFICULTY_TABLE.connect4?.hard.blunderRate).toBe(0);
  });

  it("Tic-Tac-Toe Hard searches the full unbounded tree (depth 9)", () => {
    expect(getDifficultyConfig("tictactoe", "hard").maxDepth).toBe(9);
  });

  it("depth and blunder rate are non-increasing/non-decreasing appropriately across tiers", () => {
    for (const gameId of ["tictactoe", "connect4"] as const) {
      const easy = getDifficultyConfig(gameId, "easy");
      const medium = getDifficultyConfig(gameId, "medium");
      const hard = getDifficultyConfig(gameId, "hard");
      // Deeper search at higher difficulty.
      expect(medium.maxDepth).toBeGreaterThanOrEqual(easy.maxDepth);
      expect(hard.maxDepth).toBeGreaterThanOrEqual(medium.maxDepth);
      // Lower (or equal) blunder rate at higher difficulty.
      expect(medium.blunderRate).toBeLessThanOrEqual(easy.blunderRate);
      expect(hard.blunderRate).toBeLessThanOrEqual(medium.blunderRate);
    }
  });

  it("falls back to DEFAULT_DIFFICULTY for an unknown/unconfigured GameId", () => {
    // Cast is deliberate: simulating a future/plugin GameId not present in DIFFICULTY_TABLE
    // (see types.ts's note that GameId widens to `string` in v2 / MPG-031).
    const unknownGameId = "not-a-real-game" as unknown as Parameters<typeof getDifficultyConfig>[0];
    expect(getDifficultyConfig(unknownGameId, "easy")).toEqual(DEFAULT_DIFFICULTY.easy);
    expect(getDifficultyConfig(unknownGameId, "medium")).toEqual(DEFAULT_DIFFICULTY.medium);
    expect(getDifficultyConfig(unknownGameId, "hard")).toEqual(DEFAULT_DIFFICULTY.hard);
  });
});

describe("difficulty: move computed within the time budget", () => {
  // Loose sanity bound, not a tuned benchmark — guards against gross regressions. Real
  // timing budgets (<500ms/move, PRD NFR) are documented in docs/GAME_LOGIC.md §4.
  it("Connect Four Hard (depth 7) computes a move within 500ms from the opening", () => {
    const state = connectFour.createInitialState();
    const rng = mulberry32(1);
    const start = Date.now();
    const move = pickMove(connectFour, state, "hard", rng);
    const elapsed = Date.now() - start;

    const legal = new Set(connectFour.legalMoves(state).map((m) => m.column));
    expect(legal.has(move.column)).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });

  it("Tic-Tac-Toe Hard (full depth) computes a move within 500ms from the opening", () => {
    const state = ticTacToe.createInitialState();
    const rng = mulberry32(1);
    const start = Date.now();
    const move = pickMove(ticTacToe, state, "hard", rng);
    const elapsed = Date.now() - start;

    const legal = new Set(ticTacToe.legalMoves(state).map((m) => m.cell));
    expect(legal.has(move.cell)).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
