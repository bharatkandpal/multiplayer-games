// AI strength/behavior tests for the difficulty policy. See docs/GAME_LOGIC.md §4/§6.
//
// All randomness in this file flows through a seeded PRNG (mulberry32) — never
// Math.random — so every simulated game is reproducible. No sleeps: everything here is
// synchronous and driven purely by seeded state.

import { describe, it, expect } from "vitest";
import type { GameModule, Difficulty, Player } from "../types";
import type { TicTacToeState, TicTacToeMove } from "../tictactoe";
import { ticTacToe } from "../tictactoe";
import type { ConnectFourMove } from "../connect4";
import { connectFour } from "../connect4";
import { pickMove, getDifficultyConfig, DIFFICULTY_TABLE, DEFAULT_DIFFICULTY } from "./difficulty";
import type { Rng } from "./difficulty";

/**
 * Deterministic PRNG (mulberry32): given the same seed, produces the same sequence of
 * floats in `[0, 1)` every time, in every environment. Used instead of `Math.random` for
 * every source of randomness in this file (blunder rolls and any test-side coin flips).
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

/** Outcome of a single simulated game, from `playerA`'s perspective (seat 1). */
type GameOutcome = "a_win" | "b_win" | "draw";

/**
 * Plays one full game between two difficulty "policies" using a single shared seeded
 * `rng` (so the whole game is reproducible from the seed alone). `firstMover` picks
 * whether policy A or B occupies seat 1 (moves first).
 */
function playGame<S, M>(
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

describe("difficulty: Connect Four Hard beats a random player >= 95%", () => {
  // Connect Four Hard searches depth 7 (~40-50ms/move per docs/GAME_LOGIC.md §4), so we
  // keep N modest to bound suite runtime while still comfortably demonstrating dominance
  // above the 95% bar. "random" is a uniformly-random legal move each turn (via the
  // shared seeded rng), independent of `pickMove`'s own blunder mechanism.
  const gamesPerSide = 10; // 10 with Hard moving first + 10 moving second = 20 total.

  function playHardVsRandom(rng: Rng, hardFirst: boolean): GameOutcome {
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

  function randomLegalMove<S, M>(game: GameModule<S, M>, state: S, rng: Rng): M {
    const moves = game.legalMoves(state);
    const index = Math.min(Math.floor(rng() * moves.length), moves.length - 1);
    const move = moves[index];
    if (move === undefined) throw new Error("randomLegalMove: index out of range.");
    return move;
  }

  // Depth-7 minimax over ~20 games can approach the default 5s test timeout on slower CI
  // runners; this is compute-bound, not flaky, so a generous fixed budget (below) is safe.
  it(`Hard wins >= 95% of games against a uniformly random opponent (N=${gamesPerSide * 2})`, () => {
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
    const winRate = wins / total;
    expect(winRate).toBeGreaterThanOrEqual(0.95);
  }, 20_000);
});

describe("difficulty: monotonic strength (Hard >= Medium >= Easy)", () => {
  // Score = wins + 0.5*draws (out of `games`), against a common uniformly-random-ish
  // opponent (here: the weakest tier, Easy, which itself blunders 70%/40% of the time —
  // a stable, cheap common yardstick). We allow a small tolerance since Medium/Easy are
  // themselves randomized, so a single sample of N games is a noisy estimator; the
  // inequality should still hold clearly given a rate difference this large.
  const TOLERANCE = 0.05;

  function scoreAgainstEasy(
    game: GameModule<TicTacToeState, TicTacToeMove>,
    difficulty: Difficulty,
    games: number,
  ): number {
    let score = 0;
    for (let seed = 1; seed <= games; seed++) {
      for (const firstMover of ["a", "b"] as const) {
        const rng = mulberry32(seed * 7919 + (firstMover === "a" ? 0 : 1));
        const outcome = playGame(game, difficulty, "easy", rng, firstMover);
        if (outcome === "a_win") score += 1;
        else if (outcome === "draw") score += 0.5;
      }
    }
    return score / (games * 2);
  }

  it("TTT: Hard scores >= Medium scores >= Easy scores against Easy, over seeded games", () => {
    const games = 40;
    const hardScore = scoreAgainstEasy(ticTacToe, "hard", games);
    const mediumScore = scoreAgainstEasy(ticTacToe, "medium", games);
    const easyScore = scoreAgainstEasy(ticTacToe, "easy", games); // Easy vs Easy: ~0.5 by symmetry.

    expect(hardScore).toBeGreaterThanOrEqual(mediumScore - TOLERANCE);
    expect(mediumScore).toBeGreaterThanOrEqual(easyScore - TOLERANCE);
  });

  it("Connect Four: Hard scores >= Medium scores >= Easy scores against Easy, over seeded games", () => {
    function scoreC4AgainstEasy(difficulty: Difficulty, games: number): number {
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

    // Kept modest: Connect Four Hard is the slow tier (depth 7), so this suite uses a
    // smaller N than TTT's while remaining large enough to show a clear ordering.
    const games = 6;
    const hardScore = scoreC4AgainstEasy("hard", games);
    const mediumScore = scoreC4AgainstEasy("medium", games);
    const easyScore = scoreC4AgainstEasy("easy", games);

    expect(hardScore).toBeGreaterThanOrEqual(mediumScore - TOLERANCE);
    expect(mediumScore).toBeGreaterThanOrEqual(easyScore - TOLERANCE);
  }, 20_000); // flaky, so a generous fixed budget avoids CI timeouts without masking real hangs. // Hard plays every move at depth 7 across dozens of games here; compute-bound, not
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
