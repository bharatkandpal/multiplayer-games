import type { Server } from "node:http";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerBuiltInGames, clearRegistry } from "@mpg/engine";

import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import { SESSION_HEADER, createSessionMiddleware } from "../../sessions/sessionMiddleware.js";
import { createResultRouter } from "../resultRoutes.js";

/**
 * `POST /api/results` (MPG-131) — the local-play result path.
 *
 * The tests that matter here are the ones asserting the server does NOT take the
 * client's word for anything: the outcome is replayed, not read.
 */
describe("turn-based result submission (MPG-131)", () => {
  let store: Store;
  let server: Server;
  let baseUrl: string;

  const OWNER = "tok-owner";
  const STRANGER = "tok-stranger";

  /** Tic-Tac-Toe: seat 1 takes the top row, seat 2 answers on the middle. */
  const WINNING_LOG = [
    { slot: 1, move: { cell: 0 } },
    { slot: 2, move: { cell: 3 } },
    { slot: 1, move: { cell: 1 } },
    { slot: 2, move: { cell: 4 } },
    { slot: 1, move: { cell: 2 } },
  ];

  const SEATS = [
    { slot: 1, kind: "human" },
    { slot: 2, kind: "bot", difficulty: "medium" },
  ];

  beforeEach(async () => {
    clearRegistry();
    registerBuiltInGames();
    store = createMemoryStore();

    const app = express();
    app.use(express.json());
    app.use(createSessionMiddleware(store));
    app.use("/api", createResultRouter(store));

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

  function post(body: unknown, token = OWNER): Promise<Response> {
    return fetch(`${baseUrl}/api/results`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: token },
      body: JSON.stringify(body),
    });
  }

  function submission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      runId: "run-1",
      gameId: "tictactoe",
      moveLog: WINNING_LOG,
      seatsSnapshot: SEATS,
      ...overrides,
    };
  }

  it("persists a finished game and returns the id a share link points at", async () => {
    const res = await post(submission());
    expect(res.status).toBe(201);

    const body = (await res.json()) as { ok: boolean; resultId: string };
    expect(body.ok).toBe(true);

    const saved = await store.results.findById(body.resultId);
    expect(saved).toBeDefined();
    expect(saved?.gameId).toBe("tictactoe");
    expect(saved?.gameFamily).toBe("turn-based");
    expect(saved?.ownerToken).toBe(OWNER);
  });

  it("DERIVES the outcome from its own replay, never from the request", async () => {
    // The client claims a draw won by nobody. The server never reads either
    // field — it replays the log and finds seat 1 with the top row.
    const res = await post(submission({ status: "draw", winnerSlot: null, score: 9999 }));
    const { resultId } = (await res.json()) as { resultId: string };

    const saved = await store.results.findById(resultId);
    expect(saved?.status).toBe("win");
    expect(saved?.winnerSlot).toBe(1);
    // A turn-based game has no score; a client-supplied one must not sneak into
    // a column the leaderboard ranks on.
    expect(saved?.score).toBeNull();
  });

  it("rejects a forged move log — an illegal move is never persisted as fact", async () => {
    const res = await post(
      submission({
        moveLog: [
          { slot: 1, move: { cell: 0 } },
          // Seat 1 again: not their turn. `applyMove` throws, and the whole
          // submission fails rather than being written as a win.
          { slot: 1, move: { cell: 1 } },
        ],
      }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "REPLAY_MISMATCH" });
  });

  it("rejects a game that isn't actually over", async () => {
    const res = await post(submission({ moveLog: WINNING_LOG.slice(0, 3) }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "GAME_NOT_OVER" });
  });

  it("rejects moves played past the end of the game", async () => {
    const res = await post(
      submission({ moveLog: [...WINNING_LOG, { slot: 2, move: { cell: 5 } }] }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "REPLAY_MISMATCH" });
  });

  it("is idempotent on runId — a retry can't double-write", async () => {
    const first = (await (await post(submission())).json()) as { resultId: string };
    const retry = await post(submission());

    expect(retry.status).toBe(200);
    const body = (await retry.json()) as { duplicate: boolean; resultId: string };
    expect(body.duplicate).toBe(true);
    expect(body.resultId).toBe(first.resultId);
  });

  it("refuses another session's runId instead of handing back their result id", async () => {
    await post(submission());
    // A result id is what a share link is minted against, so echoing someone
    // else's back would be a probe for rows that exist.
    const res = await post(submission(), STRANGER);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "RUN_ID_TAKEN" });
  });

  it("stores a seat snapshot it built itself, not arbitrary client JSON", async () => {
    const res = await post(
      submission({
        seatsSnapshot: [
          { slot: 1, kind: "human", sessionToken: "leaked", displayName: "<script>" },
          { slot: 2, kind: "bot", difficulty: "hard" },
        ],
      }),
    );
    const { resultId } = (await res.json()) as { resultId: string };
    const saved = await store.results.findById(resultId);

    // `seatsSnapshot` is echoed to strangers by GET /api/share/:token, so only
    // fields this route chose may survive the round trip.
    expect(saved?.seatsSnapshot).toEqual([
      { slot: 1, kind: "human" },
      { slot: 2, kind: "bot", difficulty: "hard" },
    ]);
  });

  it("rejects a seat snapshot that doesn't match the game's seat count", async () => {
    const res = await post(submission({ seatsSnapshot: [{ slot: 1, kind: "human" }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_SEATS" });
  });

  it("rejects an unknown game rather than crashing on the registry lookup", async () => {
    const res = await post(submission({ gameId: "not-a-game" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "UNKNOWN_GAME" });
  });

  it("rejects an empty or malformed move log", async () => {
    expect((await post(submission({ moveLog: [] }))).status).toBe(400);
    expect((await post(submission({ moveLog: [{ slot: 1 }] }))).status).toBe(400);
    expect((await post(submission({ moveLog: "0,1,2" }))).status).toBe(400);
  });

  it("caps replay length so the endpoint can't be used as a CPU lever", async () => {
    const res = await post(
      submission({ moveLog: Array.from({ length: 501 }, () => ({ slot: 1, move: { cell: 0 } })) }),
    );
    expect(res.status).toBe(400);
  });

  it("does NOT write a leaderboard entry — a local game against a bot isn't ranked", async () => {
    await post(submission());
    expect(await store.leaderboard.topN("tictactoe", "wld", 10)).toEqual([]);
  });
});
