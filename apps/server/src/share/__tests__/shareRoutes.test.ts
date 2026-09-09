import type { Server } from "node:http";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryStore } from "../../store/memory/index.js";
import type { GameResult, Store } from "../../store/ports.js";
import { SESSION_HEADER, createSessionMiddleware } from "../../sessions/sessionMiddleware.js";
import { createShareRouter } from "../shareRoutes.js";

describe("share link routes (MPG-056)", () => {
  let store: Store;
  let server: Server;
  let baseUrl: string;

  const OWNER = "tok-owner";
  const STRANGER = "tok-stranger";

  beforeEach(async () => {
    store = createMemoryStore();
    const app = express();
    app.use(express.json());
    app.use(createSessionMiddleware(store));
    app.use("/api", createShareRouter(store));

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

  /** Persists a finished run owned by `ownerToken`. */
  async function saveResult(ownerToken = OWNER, runId = "run-1"): Promise<GameResult> {
    await store.sessions.upsert(ownerToken);
    return store.results.save({
      runId,
      gameId: "floppy-birds",
      gameFamily: "realtime",
      ownerToken,
      status: "complete",
      score: 42,
      seatsSnapshot: null,
      moveLog: { seed: 7, inputLog: [{ flap: true }] },
    });
  }

  function call(path: string, sessionToken?: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(sessionToken ? { [SESSION_HEADER]: sessionToken } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  function mint(body: Record<string, unknown>, sessionToken = OWNER): Promise<Response> {
    return call("/api/share", sessionToken, { method: "POST", body: JSON.stringify(body) });
  }

  it("mints a durable link to a result the session owns", async () => {
    const result = await saveResult();

    const res = await mint({ kind: "result", targetId: result.id });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { token: string; kind: string; expiresAt: string | null };
    expect(body.kind).toBe("result");
    expect(body.expiresAt).toBeNull(); // expiry is optional; default is forever
    // Unguessable, not a sequential/derivable id — the token IS the capability.
    expect(body.token.length).toBeGreaterThanOrEqual(40);
    expect(body.token).not.toContain(result.id);
  });

  it("resolves a link WITHOUT a session — the token is the capability", async () => {
    const result = await saveResult();
    const { token } = (await (await mint({ kind: "result", targetId: result.id })).json()) as {
      token: string;
    };

    // No session header at all: a stranger opening the link in a fresh browser.
    const res = await call(`/api/share/${token}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { kind: string; result: Record<string, unknown> };
    expect(body.kind).toBe("result");
    expect(body.result["gameId"]).toBe("floppy-birds");
    expect(body.result["score"]).toBe(42);
  });

  it("never leaks the owner's session token or the move log on a result link", async () => {
    const result = await saveResult();
    const { token } = (await (await mint({ kind: "result", targetId: result.id })).json()) as {
      token: string;
    };

    const raw = await (await call(`/api/share/${token}`)).text();
    // The owner token is an identity credential and a share link goes to
    // strangers by design — asserted on the raw body so no nesting hides it.
    expect(raw).not.toContain(OWNER);
    expect(raw).not.toContain("moveLog");
    expect(raw).not.toContain("ownerToken");
  });

  it("includes the move log only for a replay link", async () => {
    const result = await saveResult();
    const { token } = (await (await mint({ kind: "replay", targetId: result.id })).json()) as {
      token: string;
    };

    const body = (await (await call(`/api/share/${token}`)).json()) as {
      kind: string;
      result: { moveLog: { seed: number } };
    };
    expect(body.kind).toBe("replay");
    expect(body.result.moveLog.seed).toBe(7);
    expect(JSON.stringify(body)).not.toContain(OWNER);
  });

  it("refuses to mint a link to someone else's result, indistinguishably from a missing one", async () => {
    const result = await saveResult(OWNER);
    await store.sessions.upsert(STRANGER);

    const stolen = await mint({ kind: "result", targetId: result.id }, STRANGER);
    const missing = await mint({ kind: "result", targetId: crypto.randomUUID() }, STRANGER);

    // Same status AND same body: a distinct 403 would let a caller probe which
    // result ids exist.
    expect(stolen.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await stolen.json()).toEqual(await missing.json());
  });

  it("rejects an unknown kind and a non-positive expiry", async () => {
    const result = await saveResult();

    expect((await mint({ kind: "everything", targetId: result.id })).status).toBe(400);
    expect((await mint({ kind: "result" })).status).toBe(400);
    expect((await mint({ kind: "result", targetId: result.id, expiresInMs: -5 })).status).toBe(400);
  });

  it("honors an expiry: the link resolves before it lapses and 404s after", async () => {
    const result = await saveResult();
    const { token } = (await (
      await mint({ kind: "result", targetId: result.id, expiresInMs: 60_000 })
    ).json()) as { token: string };

    expect((await call(`/api/share/${token}`)).status).toBe(200);

    // A link whose expiry has already passed is filtered by the REPO, not the
    // route — so store one directly to exercise the path the route relies on.
    await store.shareLinks.create({
      token: "lapsed-token",
      kind: "result",
      targetId: result.id,
      ownerToken: OWNER,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await call("/api/share/lapsed-token")).status).toBe(404);
  });

  it("lets the owner revoke a link, and nobody else", async () => {
    const result = await saveResult();
    const { token } = (await (await mint({ kind: "result", targetId: result.id })).json()) as {
      token: string;
    };
    await store.sessions.upsert(STRANGER);

    expect((await call(`/api/share/${token}`, STRANGER, { method: "DELETE" })).status).toBe(404);
    expect((await call(`/api/share/${token}`)).status).toBe(200); // still live

    expect((await call(`/api/share/${token}`, OWNER, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/share/${token}`)).status).toBe(404); // dead for everyone
  });

  it("404s a link whose target was swept by retention (the link outlived the result)", async () => {
    const result = await saveResult();
    const { token } = (await (await mint({ kind: "result", targetId: result.id })).json()) as {
      token: string;
    };

    await store.results.deleteByOwner(OWNER);

    // From the viewer's side this is simply a dead link — same shape, so the
    // client's dead-link screen covers it with no extra case.
    expect((await call(`/api/share/${token}`)).status).toBe(404);
  });

  it("mints a leaderboard link with no ownership check — a public view owns nobody", async () => {
    await store.sessions.upsert(STRANGER);
    const res = await mint({ kind: "leaderboard", targetId: "floppy-birds" }, STRANGER);
    expect(res.status).toBe(201);

    const { token } = (await res.json()) as { token: string };
    const body = (await (await call(`/api/share/${token}`)).json()) as {
      kind: string;
      gameId: string;
    };
    expect(body).toEqual({ kind: "leaderboard", gameId: "floppy-birds", eventId: null });
  });

  it("404s an unknown token", async () => {
    expect((await call("/api/share/definitely-not-a-token")).status).toBe(404);
  });
});
