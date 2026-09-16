import type { Server } from "node:http";

import express from "express";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { floppyBirds, hasRealtimeGame, registerBuiltInRealtimeGames } from "@mpg/engine";
import type { FloppyInput } from "@mpg/engine";

import { JSON_BODY_LIMIT } from "../../config.js";
import { createMemoryStore } from "../../store/memory/index.js";
import type { LeaderboardEntry, Store } from "../../store/ports.js";
import { SESSION_HEADER, createSessionMiddleware } from "../../sessions/sessionMiddleware.js";
import { createLeaderboardRouter } from "../leaderboardRoutes.js";
import { createStoreSink } from "../../analytics/sink.js";

const NO_FLAP: FloppyInput = { flap: false };

/** Runs a no-flap floppy-birds session from `seed` to its natural game-over. */
function buildGenuineRun(seed: number): { inputLog: FloppyInput[]; score: number } {
  let state = floppyBirds.createInitialState(seed);
  const inputLog: FloppyInput[] = [];
  let guard = 0;
  while (!floppyBirds.isGameOver(state)) {
    inputLog.push(NO_FLAP);
    state = floppyBirds.tick(state, NO_FLAP);
    guard += 1;
    if (guard > 10_000) throw new Error("floppy-birds run never ended — fixture bug");
  }
  return { inputLog, score: floppyBirds.getScore(state) };
}

describe("POST /api/leaderboard/:gameId/submit", () => {
  let store: Store;
  let server: Server;
  let baseUrl: string;

  beforeAll(() => {
    // Idempotent across test files sharing a worker — the registry throws on re-registration.
    if (!hasRealtimeGame("floppy-birds")) registerBuiltInRealtimeGames();
  });

  async function startApp(withSession: boolean): Promise<void> {
    store = createMemoryStore();
    const app = express();
    app.use(express.json({ limit: JSON_BODY_LIMIT }));
    if (withSession) app.use(createSessionMiddleware(store));
    app.use("/api", createLeaderboardRouter(store, createStoreSink(store.events)));

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a network address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  beforeEach(async () => {
    await startApp(true);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects an over-long inputLog before replaying it (MPG-021 CPU-abuse cap)", async () => {
    // 50_001 entries — one past MAX_INPUT_LOG_LENGTH. The length guard rejects it
    // before the O(n) re-simulation runs; element shape is irrelevant here, so we
    // use bare booleans to keep the body well under the JSON limit.
    const inputLog = new Array(50_001).fill(false);

    const res = await fetch(`${baseUrl}/api/leaderboard/floppy-birds/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: "tok-huge" },
      body: JSON.stringify({ seed: 7, inputLog, runId: "run-huge", score: 0 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_REQUEST");
  });

  it("accepts a genuine replayable run and writes the leaderboard entry", async () => {
    const { inputLog, score } = buildGenuineRun(7);

    const res = await fetch(`${baseUrl}/api/leaderboard/floppy-birds/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: "tok-genuine" },
      body: JSON.stringify({ seed: 7, inputLog, runId: "run-genuine", score }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; entry: LeaderboardEntry };
    expect(body.ok).toBe(true);
    expect(body.entry.bestScore).toBe(score);
    expect(body.entry.totalGames).toBe(1);

    const rankRes = await fetch(`${baseUrl}/api/leaderboard/floppy-birds/rank?metric=score`, {
      headers: { [SESSION_HEADER]: "tok-genuine" },
    });
    const rankBody = (await rankRes.json()) as { rank: number | null };
    expect(rankBody.rank).toBe(1);
  });

  // MPG-133. `game_results.seats_snapshot` is NOT NULL, and this route used to
  // write `null` for a solo run — so on Postgres every submission failed its
  // insert and took the result row, the share target and (being sequenced after
  // it) the leaderboard entry down with it. In memory the null was accepted and
  // nothing complained, so the invariant is pinned here instead: a realtime run
  // records the one seat that played it.
  it("records the solo player as a real seat, never a null snapshot", async () => {
    const { inputLog, score } = buildGenuineRun(7);

    await fetch(`${baseUrl}/api/leaderboard/floppy-birds/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: "tok-seats" },
      body: JSON.stringify({ seed: 7, inputLog, runId: "run-seats", score }),
    });

    const saved = await store.results.findByRunId("run-seats");
    expect(saved).toBeDefined();
    expect(saved?.seatsSnapshot).toEqual([{ slot: 1, kind: "human" }]);
  });

  it("rejects an inflated (tampered) score and writes nothing", async () => {
    const { inputLog, score } = buildGenuineRun(7);

    const res = await fetch(`${baseUrl}/api/leaderboard/floppy-birds/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: "tok-cheat" },
      body: JSON.stringify({ seed: 7, inputLog, runId: "run-cheat", score: score + 999 }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("SCORE_MISMATCH");

    const rankRes = await fetch(`${baseUrl}/api/leaderboard/floppy-birds/rank?metric=score`, {
      headers: { [SESSION_HEADER]: "tok-cheat" },
    });
    const rankBody = (await rankRes.json()) as { rank: number | null };
    expect(rankBody.rank).toBeNull();
  });

  it("rejects a truncated inputLog (replay never reaches game over) and writes nothing", async () => {
    const { inputLog, score } = buildGenuineRun(7);
    const truncated = inputLog.slice(0, Math.max(1, inputLog.length - 5));

    const res = await fetch(`${baseUrl}/api/leaderboard/floppy-birds/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: "tok-truncate" },
      body: JSON.stringify({ seed: 7, inputLog: truncated, runId: "run-truncate", score }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("SCORE_MISMATCH");

    const rankRes = await fetch(`${baseUrl}/api/leaderboard/floppy-birds/rank?metric=score`, {
      headers: { [SESSION_HEADER]: "tok-truncate" },
    });
    const rankBody = (await rankRes.json()) as { rank: number | null };
    expect(rankBody.rank).toBeNull();
  });

  it("is idempotent on a duplicate runId (no-op, no double bestScore bump)", async () => {
    const { inputLog, score } = buildGenuineRun(7);
    const submit = () =>
      fetch(`${baseUrl}/api/leaderboard/floppy-birds/submit`, {
        method: "POST",
        headers: { "content-type": "application/json", [SESSION_HEADER]: "tok-dup" },
        body: JSON.stringify({ seed: 7, inputLog, runId: "run-dup", score }),
      });

    const first = await submit();
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { entry: LeaderboardEntry };
    expect(firstBody.entry.totalGames).toBe(1);

    const second = await submit();
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      duplicate?: boolean;
      entry: LeaderboardEntry | null;
    };
    expect(secondBody.duplicate).toBe(true);
    expect(secondBody.entry?.totalGames).toBe(1);
    expect(secondBody.entry?.bestScore).toBe(score);
  });

  it("rejects an unknown gameId with a clean 400 (no crash)", async () => {
    const res = await fetch(`${baseUrl}/api/leaderboard/not-a-real-game/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: "tok-unknown" },
      body: JSON.stringify({ seed: 1, inputLog: [], runId: "run-unknown", score: 0 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("UNKNOWN_GAME");
  });

  it("rejects a request with no session token with a clean 400", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startApp(false); // no session middleware mounted => req.sessionToken stays undefined

    const res = await fetch(`${baseUrl}/api/leaderboard/floppy-birds/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: 7, inputLog: [], runId: "run-no-session", score: 0 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_session");
  });
});
