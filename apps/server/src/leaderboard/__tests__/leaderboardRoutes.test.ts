import type { Server } from "node:http";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import { SESSION_HEADER, createSessionMiddleware } from "../../sessions/sessionMiddleware.js";
import { createLeaderboardRouter } from "../leaderboardRoutes.js";
import { createStoreSink } from "../../analytics/sink.js";

describe("leaderboard routes", () => {
  let store: Store;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    store = createMemoryStore();
    const app = express();
    app.use(createSessionMiddleware(store));
    app.use("/api", createLeaderboardRouter(store, createStoreSink(store.events)));

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a network address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /api/leaderboard/:gameId returns top N entries ranked by wins", async () => {
    await store.leaderboard.upsert({
      gameId: "tictactoe",
      metric: "wld",
      ownerToken: "tok-a",
      wins: 3,
      totalGames: 3,
    });
    await store.leaderboard.upsert({
      gameId: "tictactoe",
      metric: "wld",
      ownerToken: "tok-b",
      wins: 1,
      totalGames: 1,
    });

    const res = await fetch(`${baseUrl}/api/leaderboard/tictactoe`, {
      headers: { [SESSION_HEADER]: "tok-c" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { ownerToken: string }[]; yourRank?: number };
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]?.ownerToken).toBe("tok-a");
    expect(body.entries[1]?.ownerToken).toBe("tok-b");
    expect(body.yourRank).toBeUndefined();
  });

  it("GET /api/leaderboard/:gameId includes yourRank for a listed player", async () => {
    await store.leaderboard.upsert({
      gameId: "tictactoe",
      metric: "wld",
      ownerToken: "tok-a",
      wins: 5,
      totalGames: 5,
    });
    await store.leaderboard.upsert({
      gameId: "tictactoe",
      metric: "wld",
      ownerToken: "tok-b",
      wins: 1,
      totalGames: 1,
    });

    const res = await fetch(`${baseUrl}/api/leaderboard/tictactoe`, {
      headers: { [SESSION_HEADER]: "tok-b" },
    });
    const body = (await res.json()) as { yourRank?: number };
    expect(body.yourRank).toBe(2);
  });

  it("respects the metric and limit query params", async () => {
    for (let i = 0; i < 3; i++) {
      await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: `tok-${i}`,
        bestScore: i * 10,
        totalGames: 1,
      });
    }

    const res = await fetch(`${baseUrl}/api/leaderboard/floppy-birds?metric=score&limit=2`, {
      headers: { [SESSION_HEADER]: "tok-x" },
    });
    const body = (await res.json()) as { entries: { bestScore: number | null }[] };
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]?.bestScore).toBe(20);
  });

  it("caps limit at 50", async () => {
    const res = await fetch(`${baseUrl}/api/leaderboard/tictactoe?limit=999`, {
      headers: { [SESSION_HEADER]: "tok-x" },
    });
    expect(res.status).toBe(200);
    // No entries exist, but the request must succeed with a clamped limit.
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toEqual([]);
  });

  it("GET /api/leaderboard/:gameId/rank returns the requester's rank + entry", async () => {
    await store.leaderboard.upsert({
      gameId: "tictactoe",
      metric: "wld",
      ownerToken: "tok-a",
      wins: 2,
      totalGames: 2,
    });
    await store.leaderboard.upsert({
      gameId: "tictactoe",
      metric: "wld",
      ownerToken: "tok-b",
      wins: 1,
      totalGames: 1,
    });

    const res = await fetch(`${baseUrl}/api/leaderboard/tictactoe/rank`, {
      headers: { [SESSION_HEADER]: "tok-b" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rank: number; entry: { ownerToken: string } };
    expect(body.rank).toBe(2);
    expect(body.entry.ownerToken).toBe("tok-b");
  });

  it("GET /api/leaderboard/:gameId/rank returns null rank when not on the board", async () => {
    const res = await fetch(`${baseUrl}/api/leaderboard/tictactoe/rank`, {
      headers: { [SESSION_HEADER]: "tok-nobody" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rank: number | null };
    expect(body.rank).toBeNull();
  });
});
