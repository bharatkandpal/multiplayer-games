import { describe, expect, it } from "vitest";

import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import {
  updateLeaderboardForScore,
  updateLeaderboardForTurnBased,
  updateLeaderboardsForTurnBasedGameOver,
} from "../leaderboardWriter.js";

describe("leaderboardWriter", () => {
  describe("updateLeaderboardForTurnBased", () => {
    it("records a win", async () => {
      const store: Store = createMemoryStore();
      const entry = await updateLeaderboardForTurnBased(store, {
        gameId: "tictactoe",
        ownerToken: "tok-1",
        outcome: "win",
        runId: "run-1",
      });
      expect(entry.metric).toBe("wld");
      expect(entry.wins).toBe(1);
      expect(entry.losses).toBe(0);
      expect(entry.draws).toBe(0);
      expect(entry.totalGames).toBe(1);
    });

    it("records a loss", async () => {
      const store: Store = createMemoryStore();
      const entry = await updateLeaderboardForTurnBased(store, {
        gameId: "tictactoe",
        ownerToken: "tok-1",
        outcome: "loss",
      });
      expect(entry.wins).toBe(0);
      expect(entry.losses).toBe(1);
      expect(entry.totalGames).toBe(1);
    });

    it("records a draw", async () => {
      const store: Store = createMemoryStore();
      const entry = await updateLeaderboardForTurnBased(store, {
        gameId: "tictactoe",
        ownerToken: "tok-1",
        outcome: "draw",
      });
      expect(entry.draws).toBe(1);
      expect(entry.totalGames).toBe(1);
    });

    it("accumulates across multiple games for the same owner", async () => {
      const store: Store = createMemoryStore();
      await updateLeaderboardForTurnBased(store, {
        gameId: "tictactoe",
        ownerToken: "tok-1",
        outcome: "win",
      });
      const entry = await updateLeaderboardForTurnBased(store, {
        gameId: "tictactoe",
        ownerToken: "tok-1",
        outcome: "loss",
      });
      expect(entry.wins).toBe(1);
      expect(entry.losses).toBe(1);
      expect(entry.totalGames).toBe(2);
    });
  });

  describe("updateLeaderboardForScore", () => {
    it("sets bestScore and increments totalGames", async () => {
      const store: Store = createMemoryStore();
      const entry = await updateLeaderboardForScore(store, {
        gameId: "floppy-birds",
        ownerToken: "tok-2",
        score: 10,
      });
      expect(entry.metric).toBe("score");
      expect(entry.bestScore).toBe(10);
      expect(entry.totalGames).toBe(1);
    });

    it("keeps the max bestScore across runs", async () => {
      const store: Store = createMemoryStore();
      await updateLeaderboardForScore(store, {
        gameId: "floppy-birds",
        ownerToken: "tok-2",
        score: 10,
      });
      const higher = await updateLeaderboardForScore(store, {
        gameId: "floppy-birds",
        ownerToken: "tok-2",
        score: 25,
      });
      expect(higher.bestScore).toBe(25);
      expect(higher.totalGames).toBe(2);

      const lower = await updateLeaderboardForScore(store, {
        gameId: "floppy-birds",
        ownerToken: "tok-2",
        score: 5,
      });
      expect(lower.bestScore).toBe(25);
      expect(lower.totalGames).toBe(3);
    });
  });

  describe("updateLeaderboardsForTurnBasedGameOver", () => {
    it("updates every human seat with win/loss based on the winner slot", async () => {
      const store: Store = createMemoryStore();
      const seats = [
        { slot: 0, kind: "human" as const, sessionToken: "tok-a" },
        { slot: 1, kind: "human" as const, sessionToken: "tok-b" },
      ];

      await updateLeaderboardsForTurnBasedGameOver(store, "tictactoe", seats, {
        status: "win",
        winner: 0,
      });

      const winner = await store.leaderboard.rankOf("tictactoe", "wld", "tok-a");
      const loserEntries = await store.leaderboard.topN("tictactoe", "wld", 10);
      const loser = loserEntries.find((e) => e.ownerToken === "tok-b");

      expect(winner).toBe(1);
      const winnerEntries = await store.leaderboard.topN("tictactoe", "wld", 10);
      const winnerEntry = winnerEntries.find((e) => e.ownerToken === "tok-a");
      expect(winnerEntry?.wins).toBe(1);
      expect(loser?.losses).toBe(1);
    });

    it("updates every human seat with a draw", async () => {
      const store: Store = createMemoryStore();
      const seats = [
        { slot: 0, kind: "human" as const, sessionToken: "tok-a" },
        { slot: 1, kind: "human" as const, sessionToken: "tok-b" },
      ];

      await updateLeaderboardsForTurnBasedGameOver(store, "tictactoe", seats, {
        status: "draw",
      });

      const entries = await store.leaderboard.topN("tictactoe", "wld", 10);
      expect(entries.every((e) => e.draws === 1)).toBe(true);
    });

    it("skips bot seats (no session token)", async () => {
      const store: Store = createMemoryStore();
      const seats = [
        { slot: 0, kind: "human" as const, sessionToken: "tok-a" },
        { slot: 1, kind: "bot" as const },
      ];

      await updateLeaderboardsForTurnBasedGameOver(store, "tictactoe", seats, {
        status: "win",
        winner: 0,
      });

      const entries = await store.leaderboard.topN("tictactoe", "wld", 10);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.ownerToken).toBe("tok-a");
    });
  });
});
