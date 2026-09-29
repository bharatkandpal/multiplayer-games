// Full-depth AI strength sweeps for the difficulty policy (MPG-151). See
// docs/GAME_LOGIC.md §4/§6 and difficulty.test.ts (same conventions: every source of
// randomness flows through a seeded PRNG, never Math.random).
//
// This file is the deep, larger-sample counterpart to the cheap checks in
// difficulty.test.ts: identical simulation logic (shared via
// difficulty-test-support.ts), just far more seeded games — Connect Four Hard is a
// depth-7 search, so a statistically comfortable sample here costs ~25s, well past what
// `test:fast` (and therefore pre-push) can afford on every push.
//
// `packages/engine/package.json`'s `test:fast` excludes this file by name, so it does
// NOT run on `git push` (`.husky/pre-push` → `pnpm verify:fast`). It runs on:
//   - `pnpm test` / `pnpm verify` (the full suite), e.g. before opening a PR.
//   - The manual `Verify` GitHub Actions workflow (`gh workflow run ci.yml`).
// The cheap, every-push version of the same "Hard is actually hard" claim lives in
// difficulty.test.ts and must never be removed in favor of only this file — see MPG-151.

import { describe, it, expect } from "vitest";
import {
  hardVsRandomWinRate,
  scoreC4AgainstEasy,
  MONOTONIC_TOLERANCE,
} from "./difficulty-test-support";

describe("difficulty: Connect Four Hard beats a random player >= 95% (exhaustive)", () => {
  // Connect Four Hard searches depth 7 (~40-50ms/move per docs/GAME_LOGIC.md §4), so we
  // keep N modest to bound suite runtime while still comfortably demonstrating dominance
  // above the 95% bar. "random" is a uniformly-random legal move each turn (via the
  // shared seeded rng), independent of `pickMove`'s own blunder mechanism.
  const gamesPerSide = 10; // 10 with Hard moving first + 10 moving second = 20 total.

  // Depth-7 minimax over ~20 games can approach the default 5s test timeout on slower CI
  // runners; this is compute-bound, not flaky, so a generous fixed budget (below) is safe.
  it(`Hard wins >= 95% of games against a uniformly random opponent (N=${gamesPerSide * 2})`, () => {
    const winRate = hardVsRandomWinRate(gamesPerSide);
    expect(winRate).toBeGreaterThanOrEqual(0.95);
  }, 20_000);
});

describe("difficulty: Connect Four monotonic strength (Hard >= Medium >= Easy, exhaustive)", () => {
  const TOLERANCE = MONOTONIC_TOLERANCE;

  // Kept modest relative to TTT's N: Connect Four Hard is the slow tier (depth 7), so
  // this suite uses a smaller N while remaining large enough to show a clear ordering.
  // Flaky-adjacent on loaded CI (Hard plays every move at depth 7 across dozens of games
  // here, compute-bound not flaky), so a generous fixed timeout (below) avoids timeouts
  // without masking real hangs.
  it("Connect Four: Hard scores >= Medium scores >= Easy scores against Easy, over seeded games", () => {
    const games = 6;
    const hardScore = scoreC4AgainstEasy("hard", games);
    const mediumScore = scoreC4AgainstEasy("medium", games);
    const easyScore = scoreC4AgainstEasy("easy", games);

    expect(hardScore).toBeGreaterThanOrEqual(mediumScore - TOLERANCE);
    expect(mediumScore).toBeGreaterThanOrEqual(easyScore - TOLERANCE);
  }, 20_000);
});
