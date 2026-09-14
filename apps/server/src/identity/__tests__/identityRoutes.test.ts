import type { Server } from "node:http";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import { SESSION_HEADER, createSessionMiddleware } from "../../sessions/sessionMiddleware.js";
import { createIdentityRouter } from "../identityRoutes.js";

describe("identity routes", () => {
  let store: Store;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    store = createMemoryStore();
    const app = express();
    app.use(express.json());
    app.use(createSessionMiddleware(store));
    app.use("/api", createIdentityRouter(store));

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

  /** A request pinned to a fixed session token, so a "device" persists across calls. */
  function as(token: string, path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", [SESSION_HEADER]: token, ...init?.headers },
    });
  }

  function claim(token: string, handle: string) {
    return as(token, "/api/identity/claim", {
      method: "POST",
      body: JSON.stringify({ handle }),
    });
  }

  it("GET /api/identity is null for an unclaimed session", async () => {
    const res = await as("sess-a", "/api/identity");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handle: null, claimed: false });
  });

  it("claims a handle and returns a one-time recovery code", async () => {
    const res = await claim("sess-a", "Nova");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { handle: string; recoveryCode: string };
    expect(body.handle).toBe("Nova");
    expect(body.recoveryCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);

    const after = await (await as("sess-a", "/api/identity")).json();
    expect(after).toEqual({ handle: "Nova", claimed: true });
  });

  it("rejects a handle that fails moderation (400 INVALID_HANDLE)", async () => {
    const res = await claim("sess-a", "x"); // too short for the handle length cap
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "INVALID_HANDLE" });
  });

  it("rejects a second claim from the same session (409 ALREADY_CLAIMED)", async () => {
    await claim("sess-a", "Nova");
    const res = await claim("sess-a", "Orbit");
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "ALREADY_CLAIMED" });
  });

  it("rejects a handle already taken by another session (409 HANDLE_TAKEN)", async () => {
    await claim("sess-a", "Nova");
    const res = await claim("sess-b", "nova"); // case-insensitive collision
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "HANDLE_TAKEN" });
  });

  it("adopts an identity onto a new device by recovery code", async () => {
    const claimed = (await (await claim("sess-a", "Nova")).json()) as { recoveryCode: string };

    const adopt = await as("sess-b", "/api/identity/adopt", {
      method: "POST",
      body: JSON.stringify({ recoveryCode: claimed.recoveryCode }),
    });
    expect(adopt.status).toBe(200);
    expect((await adopt.json()) as { handle: string }).toEqual({ handle: "Nova" });

    // The new device now resolves to the same handle.
    expect(await (await as("sess-b", "/api/identity")).json()).toEqual({
      handle: "Nova",
      claimed: true,
    });
  });

  it("accepts a recovery code regardless of case/spacing", async () => {
    const claimed = (await (await claim("sess-a", "Nova")).json()) as { recoveryCode: string };
    const messy = claimed.recoveryCode.toLowerCase().replace(/-/g, " ");

    const adopt = await as("sess-b", "/api/identity/adopt", {
      method: "POST",
      body: JSON.stringify({ recoveryCode: messy }),
    });
    expect(adopt.status).toBe(200);
  });

  it("rejects adoption with a malformed or unknown code (400, never 5xx)", async () => {
    const bad = await as("sess-b", "/api/identity/adopt", {
      method: "POST",
      body: JSON.stringify({ recoveryCode: "nope" }),
    });
    expect(bad.status).toBe(400);

    const unknown = await as("sess-b", "/api/identity/adopt", {
      method: "POST",
      body: JSON.stringify({ recoveryCode: "2345-6789-ABCD-EFGH" }),
    });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()) as { error: string }).toEqual({ error: "INVALID_RECOVERY_CODE" });
  });
});
