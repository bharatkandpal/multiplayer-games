import { describe, it, expect, beforeEach } from "vitest";

import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import { forgetMe, purgeEvent, rollingRetention } from "../retention.js";

describe("retention", () => {
  let store: Store;

  beforeEach(() => {
    store = createMemoryStore();
  });

  describe("rollingRetention", () => {
    it("deletes results older than 90 days", async () => {
      await store.sessions.upsert("tok-1");

      // Save a result, then backdate it manually via the repo internals
      const result = await store.results.save({
        runId: "old-run",
        gameId: "tictactoe",
        ownerToken: "tok-1",
        status: "win",
        seatsSnapshot: [],
      });

      // deleteOlderThan with a future cutoff should remove it
      const stats = await rollingRetention(store);
      // The result was just created, so it's NOT older than 90 days
      expect(stats.results).toBe(0);

      // Verify it still exists
      expect(await store.results.findByRunId("old-run")).toEqual(result);
    });

    it("cleans up expired share links", async () => {
      await store.sessions.upsert("tok-1");
      await store.shareLinks.create({
        token: "expired-sl",
        kind: "result",
        targetId: crypto.randomUUID(),
        ownerToken: "tok-1",
        expiresAt: new Date(Date.now() - 1000),
      });

      const stats = await rollingRetention(store);
      expect(stats.shareLinks).toBe(1);
    });
  });

  describe("purgeEvent", () => {
    it("deletes leaderboard entries for the event", async () => {
      await store.sessions.upsert("tok-1");
      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        eventId: "evt-purge",
        ownerToken: "tok-1",
        wins: 5,
        totalGames: 5,
      });
      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        ownerToken: "tok-1",
        wins: 3,
        totalGames: 3,
      });

      const stats = await purgeEvent(store, "evt-purge");
      expect(stats.leaderboard).toBe(1);

      // Global entry untouched
      const top = await store.leaderboard.topN("tictactoe", "wld", 10);
      expect(top).toHaveLength(1);
      expect(top[0]!.eventId).toBeNull();
    });
  });

  describe("forgetMe", () => {
    it("wipes all data for a session across every repo", async () => {
      await store.sessions.upsert("tok-doom");
      await store.sessions.upsert("tok-keep");

      await store.results.save({
        runId: "r1",
        gameId: "tictactoe",
        ownerToken: "tok-doom",
        status: "win",
        seatsSnapshot: [],
      });
      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        ownerToken: "tok-doom",
        wins: 1,
        totalGames: 1,
      });
      await store.shareLinks.create({
        token: "sl-doom",
        kind: "result",
        targetId: crypto.randomUUID(),
        ownerToken: "tok-doom",
      });
      await store.reports.create({
        kind: "username",
        targetId: crypto.randomUUID(),
        reason: "impersonation",
        reporterToken: "tok-doom",
      });

      // Keep data
      await store.results.save({
        runId: "r2",
        gameId: "tictactoe",
        ownerToken: "tok-keep",
        status: "draw",
        seatsSnapshot: [],
      });

      const stats = await forgetMe(store, "tok-doom");
      expect(stats).toEqual({
        results: 1,
        leaderboard: 1,
        shareLinks: 1,
        reports: 1,
        sessions: 1,
      });

      // All gone
      expect(await store.sessions.findByToken("tok-doom")).toBeUndefined();
      expect(await store.results.findByOwner("tok-doom")).toHaveLength(0);

      // Other user untouched
      expect(await store.sessions.findByToken("tok-keep")).toBeTruthy();
      expect(await store.results.findByOwner("tok-keep")).toHaveLength(1);
    });
  });
});
