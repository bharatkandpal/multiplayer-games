import type { Server } from "node:http";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function json(body: unknown) {
  return {
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import { SESSION_HEADER, createSessionMiddleware } from "../sessionMiddleware.js";
import { createSessionRouter } from "../sessionRoutes.js";

describe("session routes", () => {
  let store: Store;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    store = createMemoryStore();
    const app = express();
    app.use(express.json());
    app.use(createSessionMiddleware(store));
    app.use("/api", createSessionRouter(store));

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

  it("GET /api/session creates and returns a session", async () => {
    const res = await fetch(`${baseUrl}/api/session`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; createdAt: string };
    expect(body.token).toBeTruthy();
    expect(body.createdAt).toBeTruthy();

    const stored = await store.sessions.findByToken(body.token);
    expect(stored).toBeDefined();
  });

  it("GET /api/session reuses the token from the header", async () => {
    const res = await fetch(`${baseUrl}/api/session`, {
      headers: { [SESSION_HEADER]: "reuse-me" },
    });
    const body = (await res.json()) as { token: string };
    expect(body.token).toBe("reuse-me");
  });

  it("DELETE /api/session forgets the session and its data", async () => {
    const token = "delete-me";
    await store.sessions.upsert(token);
    await store.results.save({
      runId: "run-1",
      gameId: "tictactoe",
      ownerToken: token,
      status: "win",
      seatsSnapshot: [],
    });

    const res = await fetch(`${baseUrl}/api/session`, {
      method: "DELETE",
      headers: { [SESSION_HEADER]: token },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deleted: { results: number; sessions: number };
    };
    expect(body.deleted.results).toBe(1);
    expect(body.deleted.sessions).toBe(1);

    expect(await store.sessions.findByToken(token)).toBeUndefined();
    expect(await store.results.findByRunId("run-1")).toBeUndefined();
  });

  it("GET /api/session/history returns paginated results for the session", async () => {
    const token = "history-tok";
    await store.sessions.upsert(token);
    for (let i = 0; i < 3; i++) {
      await store.results.save({
        runId: `run-${i}`,
        gameId: "tictactoe",
        ownerToken: token,
        status: "win",
        seatsSnapshot: [],
      });
    }

    const res = await fetch(`${baseUrl}/api/session/history?limit=2&offset=0`, {
      headers: { [SESSION_HEADER]: token },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(2);
  });

  it("GET /api/session/history returns an empty list for a fresh session", async () => {
    const res = await fetch(`${baseUrl}/api/session/history`, {
      headers: { [SESSION_HEADER]: "brand-new" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it("GET /api/session/history unions results across identity-linked devices (MPG-091-b)", async () => {
    const HASH = "a".repeat(64);
    // Device A claims an identity; device B adopts it via the recovery code.
    await store.sessions.upsert("dev-A");
    await store.sessions.upsert("dev-B");
    await store.identities.claim("dev-A", "Nova", HASH);
    await store.identities.adopt("dev-B", HASH);

    await store.results.save({
      runId: "on-A",
      gameId: "tictactoe",
      ownerToken: "dev-A",
      status: "win",
      seatsSnapshot: [],
    });
    await new Promise((r) => setTimeout(r, 5));
    await store.results.save({
      runId: "on-B",
      gameId: "tictactoe",
      ownerToken: "dev-B",
      status: "win",
      seatsSnapshot: [],
    });

    // Reading from device B sees device A's game too, newest first.
    const res = await fetch(`${baseUrl}/api/session/history`, {
      headers: { [SESSION_HEADER]: "dev-B" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { runId: string }[] };
    expect(body.results.map((r) => r.runId)).toEqual(["on-B", "on-A"]);
  });

  it("GET /api/session/history stays single-owner for an unclaimed session (MPG-091-b)", async () => {
    await store.sessions.upsert("solo");
    await store.sessions.upsert("stranger");
    await store.results.save({
      runId: "mine",
      gameId: "tictactoe",
      ownerToken: "solo",
      status: "win",
      seatsSnapshot: [],
    });
    await store.results.save({
      runId: "theirs",
      gameId: "tictactoe",
      ownerToken: "stranger",
      status: "win",
      seatsSnapshot: [],
    });

    const res = await fetch(`${baseUrl}/api/session/history`, {
      headers: { [SESSION_HEADER]: "solo" },
    });
    const body = (await res.json()) as { results: { runId: string }[] };
    expect(body.results.map((r) => r.runId)).toEqual(["mine"]);
  });

  it("GET /api/session reports username: null before one is set", async () => {
    const res = await fetch(`${baseUrl}/api/session`, {
      headers: { [SESSION_HEADER]: "no-username-yet" },
    });
    const body = (await res.json()) as { username: string | null };
    expect(body.username).toBeNull();
  });

  describe("POST /api/session/username", () => {
    it("claims a valid username", async () => {
      const res = await fetch(`${baseUrl}/api/session/username`, {
        ...json({ username: "bharat_k" }),
        headers: { ...json({}).headers, [SESSION_HEADER]: "user-1" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string; username: string };
      expect(body.username).toBe("bharat_k");

      const stored = await store.sessions.findByToken("user-1");
      expect(stored?.username).toBe("bharat_k");
    });

    it("is readable back via GET /api/session", async () => {
      await fetch(`${baseUrl}/api/session/username`, {
        ...json({ username: "readback" }),
        headers: { ...json({}).headers, [SESSION_HEADER]: "user-readback" },
      });

      const res = await fetch(`${baseUrl}/api/session`, {
        headers: { [SESSION_HEADER]: "user-readback" },
      });
      const body = (await res.json()) as { username: string | null };
      expect(body.username).toBe("readback");
    });

    it("400s with INVALID_USERNAME when too short", async () => {
      const res = await fetch(`${baseUrl}/api/session/username`, {
        ...json({ username: "ab" }),
        headers: { ...json({}).headers, [SESSION_HEADER]: "user-2" },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("INVALID_USERNAME");
    });

    it("400s with INVALID_USERNAME when too long", async () => {
      const res = await fetch(`${baseUrl}/api/session/username`, {
        ...json({ username: "a".repeat(21) }),
        headers: { ...json({}).headers, [SESSION_HEADER]: "user-3" },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("INVALID_USERNAME");
    });

    it("400s with INVALID_USERNAME on disallowed characters", async () => {
      const res = await fetch(`${baseUrl}/api/session/username`, {
        ...json({ username: "bad name!" }),
        headers: { ...json({}).headers, [SESSION_HEADER]: "user-4" },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("INVALID_USERNAME");
    });

    it("400s with INVALID_USERNAME + reason PROFANITY on a profane handle", async () => {
      const res = await fetch(`${baseUrl}/api/session/username`, {
        ...json({ username: "sh1thead" }),
        headers: { ...json({}).headers, [SESSION_HEADER]: "user-profane" },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; reason: string };
      expect(body.error).toBe("INVALID_USERNAME");
      expect(body.reason).toBe("PROFANITY");
    });

    it("400s with INVALID_USERNAME + reason RESERVED on an impersonating handle", async () => {
      const res = await fetch(`${baseUrl}/api/session/username`, {
        ...json({ username: "admin123" }),
        headers: { ...json({}).headers, [SESSION_HEADER]: "user-reserved" },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; reason: string };
      expect(body.error).toBe("INVALID_USERNAME");
      expect(body.reason).toBe("RESERVED");
    });

    it("409s with USERNAME_TAKEN on a real collision (case-insensitive)", async () => {
      await fetch(`${baseUrl}/api/session/username`, {
        ...json({ username: "Unique" }),
        headers: { ...json({}).headers, [SESSION_HEADER]: "user-5" },
      });

      const res = await fetch(`${baseUrl}/api/session/username`, {
        ...json({ username: "unique" }),
        headers: { ...json({}).headers, [SESSION_HEADER]: "user-6" },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("USERNAME_TAKEN");
    });

    it("is idempotent — re-posting your own current username succeeds", async () => {
      await fetch(`${baseUrl}/api/session/username`, {
        ...json({ username: "sameuser" }),
        headers: { ...json({}).headers, [SESSION_HEADER]: "user-7" },
      });

      const res = await fetch(`${baseUrl}/api/session/username`, {
        ...json({ username: "SameUser" }),
        headers: { ...json({}).headers, [SESSION_HEADER]: "user-7" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { username: string };
      expect(body.username).toBe("SameUser");
    });
  });
});
