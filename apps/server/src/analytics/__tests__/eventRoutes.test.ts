import type { Server } from "node:http";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SESSION_HEADER, createSessionMiddleware } from "../../sessions/sessionMiddleware.js";
import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import { createEventRouter } from "../eventRoutes.js";
import { createStoreSink } from "../sink.js";

describe("POST /api/events (MPG-097)", () => {
  let store: Store;
  let server: Server;
  let baseUrl: string;

  const SESSION = "tok-session";

  const WINDOW_START = new Date(0);
  const WINDOW_END = new Date("2100-01-01T00:00:00.000Z");

  beforeEach(async () => {
    store = createMemoryStore();
    await store.sessions.upsert(SESSION);

    const app = express();
    app.use(express.json());
    app.use(createSessionMiddleware(store));
    app.use("/api", createEventRouter(createStoreSink(store.events)));

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

  async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: SESSION, ...headers },
      body: JSON.stringify(body),
    });
  }

  async function countsByName(): Promise<Record<string, number>> {
    const rows = await store.events.countByName(WINDOW_START, WINDOW_END);
    return Object.fromEntries(rows.map((r) => [r.name, r.count]));
  }

  it("accepts a client-reportable event and records it", async () => {
    const res = await post({ events: [{ name: "first_input", props: { msSinceArrival: 900 } }] });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1, dropped: 0 });
    expect(await countsByName()).toEqual({ first_input: 1 });
  });

  it("drops server-side events reported by a client without failing the request", async () => {
    // The client must not be able to inflate the share rate. Dropping rather
    // than 4xx-ing keeps a stale client from retrying forever.
    const res = await post({
      events: [{ name: "share_minted" }, { name: "result_saved" }, { name: "first_input" }],
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1, dropped: 2 });
    expect(await countsByName()).toEqual({ first_input: 1 });
  });

  it("drops unknown event names rather than storing them", async () => {
    const res = await post({ events: [{ name: "shareOpened" }, { name: "totally_made_up" }] });

    expect(await res.json()).toEqual({ accepted: 0, dropped: 2 });
    expect(await countsByName()).toEqual({});
  });

  it("drops events whose props violate the privacy boundary", async () => {
    const res = await post({
      events: [
        { name: "first_input", props: { url: "x".repeat(200) } },
        { name: "first_input", props: { nested: { a: 1 } } },
        { name: "first_input", props: { msSinceArrival: 10 } },
      ],
    });

    expect(await res.json()).toEqual({ accepted: 1, dropped: 2 });
  });

  it("rejects a structurally invalid body", async () => {
    // A bug in the caller, unlike a stale event name — so this one does 4xx.
    expect((await post({})).status).toBe(400);
    expect((await post({ events: "nope" })).status).toBe(400);
  });

  it("rejects an oversized batch", async () => {
    const events = Array.from({ length: 51 }, () => ({ name: "first_input" }));
    const res = await post({ events });

    expect(res.status).toBe(413);
  });

  it("accepts an empty batch as a no-op", async () => {
    const res = await post({ events: [] });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 0, dropped: 0 });
  });

  it("honours a plausible client timestamp so late batches are not smeared to flush time", async () => {
    const occurredAt = Date.now() - 60_000;
    await post({ events: [{ name: "first_input", occurredAt }] });

    // Window ends before "now" but after the claimed occurrence: the event is
    // only in it if the client's timestamp was honoured.
    const rows = await store.events.countByName(
      new Date(occurredAt - 1000),
      new Date(occurredAt + 1000),
    );
    expect(rows).toEqual([{ name: "first_input", count: 1 }]);
  });

  it("accepts a text/plain beacon body carrying the session token", async () => {
    // `sendBeacon` cannot set headers and must stay CORS-simple, so this is the
    // only shape a flush-on-teardown can take.
    const res = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ events: [{ name: "first_input" }], sessionToken: SESSION }),
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1, dropped: 0 });

    // Attributed to the real session, not to a freshly minted one — otherwise
    // every bounced visit would look like a brand-new user.
    expect(await store.events.countDistinctOwners("first_input", WINDOW_START, WINDOW_END)).toBe(1);
  });
});
