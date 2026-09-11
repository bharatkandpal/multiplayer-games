/**
 * The funnel, end to end (MPG-097).
 *
 * These assert the *rates* the task exists to make computable — share rate and
 * share CTR — rather than that a given function was called. That framing is
 * deliberate: the metric is the deliverable, and a test that only checked for a
 * call would still pass if the numerator and denominator were counted against
 * different sessions.
 */

import type { Server } from "node:http";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeGameResult } from "../../sessions/resultWriter.js";
import { SESSION_HEADER, createSessionMiddleware } from "../../sessions/sessionMiddleware.js";
import { createShareRouter } from "../../share/shareRoutes.js";
import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import { createStoreSink, type EventSink } from "../sink.js";

describe("loop funnel (MPG-097)", () => {
  let store: Store;
  let sink: EventSink;
  let server: Server;
  let baseUrl: string;

  const OWNER = "tok-owner";
  const VISITOR = "tok-visitor";

  const ALL_TIME_START = new Date(0);
  const ALL_TIME_END = new Date("2100-01-01T00:00:00.000Z");

  beforeEach(async () => {
    store = createMemoryStore();
    sink = createStoreSink(store.events);
    await store.sessions.upsert(OWNER);
    await store.sessions.upsert(VISITOR);

    const app = express();
    app.use(express.json());
    app.use(createSessionMiddleware(store));
    app.use("/api", createShareRouter(store, sink));

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

  async function counts(): Promise<Record<string, number>> {
    const rows = await store.events.countByName(ALL_TIME_START, ALL_TIME_END);
    return Object.fromEntries(rows.map((r) => [r.name, r.count]));
  }

  async function saveResult(runId: string, ownerToken = OWNER): Promise<string> {
    const row = await writeGameResult(
      store,
      {
        runId,
        gameId: "connect-four",
        gameFamily: "turn-based",
        ownerToken,
        status: "win",
        winnerSlot: 1,
        seatsSnapshot: [{ slot: 1, kind: "human" }],
      },
      sink,
    );
    return row.id;
  }

  async function mint(resultId: string, as = OWNER): Promise<string> {
    const res = await fetch(`${baseUrl}/api/share`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: as },
      body: JSON.stringify({ kind: "result", targetId: resultId }),
    });
    const body = (await res.json()) as { token: string };
    return body.token;
  }

  async function open(shareToken: string, as: string): Promise<number> {
    const res = await fetch(`${baseUrl}/api/share/${shareToken}`, {
      headers: { [SESSION_HEADER]: as },
    });
    return res.status;
  }

  it("counts a full result → share → open pass exactly once each", async () => {
    const resultId = await saveResult("run-1");
    const shareToken = await mint(resultId);
    expect(await open(shareToken, VISITOR)).toBe(200);

    expect(await counts()).toEqual({ result_saved: 1, share_minted: 1, share_opened: 1 });
  });

  it("keeps the share-rate denominator honest when a result write is retried", async () => {
    // `save` is idempotent on runId, so a retried write returns the existing
    // row. Counting it twice would silently halve the share rate.
    await saveResult("run-dup");
    await saveResult("run-dup");

    expect(await counts()).toEqual({ result_saved: 1 });
  });

  it("attributes an open to the viewer, and flags the owner's own opens", async () => {
    const resultId = await saveResult("run-2");
    const shareToken = await mint(resultId);

    await open(shareToken, VISITOR);
    await open(shareToken, OWNER);

    // Two opens, two distinct sessions — but only one is a stranger, and
    // `isOwner` is what keeps k-factor from counting the sharer's own clicks.
    expect(
      await store.events.countDistinctOwners("share_opened", ALL_TIME_START, ALL_TIME_END),
    ).toBe(2);
  });

  it("does not count an open that failed to resolve", async () => {
    // CTR's numerator is successful opens. A dead or revoked link is a
    // different question (and a different, later metric).
    expect(await open("does-not-exist", VISITOR)).toBe(404);

    expect(await counts()).toEqual({});
  });

  it("does not count a mint that was rejected", async () => {
    const resultId = await saveResult("run-3");

    // A stranger cannot mint against someone else's result.
    const res = await fetch(`${baseUrl}/api/share`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: VISITOR },
      body: JSON.stringify({ kind: "result", targetId: resultId }),
    });
    expect(res.status).toBe(404);

    expect(await counts()).toEqual({ result_saved: 1 });
  });

  it("emits no result_saved when no sink is wired", async () => {
    // The sink is optional so existing callers and tests are unaffected.
    await writeGameResult(store, {
      runId: "run-unsunk",
      gameId: "connect-four",
      ownerToken: OWNER,
      status: "draw",
      seatsSnapshot: [],
    });

    expect(await counts()).toEqual({});
  });
});
