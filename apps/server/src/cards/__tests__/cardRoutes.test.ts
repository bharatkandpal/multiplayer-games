import type { Server } from "node:http";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryStore } from "../../store/memory/index.js";
import type { GameResult, ShareLink, Store } from "../../store/ports.js";
import { createCardRouter } from "../cardRoutes.js";

/**
 * `GET /api/cards/:token.png` (MPG-085-b) — the public unfurl image.
 *
 * The endpoint is capability-gated by the token and session-free, so these tests
 * fetch it with no session at all — exactly as a scraper would.
 */
describe("share card image (MPG-085-b)", () => {
  let store: Store;
  let server: Server;
  let baseUrl: string;

  const OWNER = "tok-owner";

  beforeEach(async () => {
    store = createMemoryStore();
    const app = express();
    app.use("/api", createCardRouter(store));

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

  async function saveResult(runId = "run-1"): Promise<GameResult> {
    await store.sessions.upsert(OWNER);
    return store.results.save({
      runId,
      gameId: "floppy-birds",
      gameFamily: "realtime",
      ownerToken: OWNER,
      status: "complete",
      score: 42,
      seatsSnapshot: null,
    });
  }

  function link(kind: string, targetId: string, token = "tok-card"): Promise<ShareLink> {
    return store.shareLinks.create({ token, kind, targetId, ownerToken: OWNER });
  }

  it("renders a PNG for a result link, cached immutably", async () => {
    const result = await saveResult();
    await link("result", result.id);

    const res = await fetch(`${baseUrl}/api/cards/tok-card.png`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");

    const bytes = new Uint8Array(await res.arrayBuffer());
    // A real PNG: the 8-byte signature, and enough bytes that text actually drew
    // (a bundled font resolved) rather than a blank card.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("404s an unknown token (dead link → no image, never a 5xx)", async () => {
    const res = await fetch(`${baseUrl}/api/cards/does-not-exist.png`);
    expect(res.status).toBe(404);
  });

  it("404s a leaderboard link — it has no result to draw", async () => {
    await link("leaderboard", "floppy-birds", "tok-lb");
    const res = await fetch(`${baseUrl}/api/cards/tok-lb.png`);
    expect(res.status).toBe(404);
  });

  it("404s a link whose result has been deleted", async () => {
    await link("result", "missing-result-id", "tok-orphan");
    const res = await fetch(`${baseUrl}/api/cards/tok-orphan.png`);
    expect(res.status).toBe(404);
  });
});
