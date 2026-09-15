import type { Server } from "node:http";

import { hasGame, registerBuiltInGames, registerBuiltInRealtimeGames } from "@mpg/engine";
import express, {
  type NextFunction,
  type Request as ExRequest,
  type Response as ExResponse,
} from "express";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createStoreSink } from "../../analytics/sink.js";
import type { RateLimitFor } from "../../middleware/rateLimit.js";
import { createShareRouter } from "../../share/shareRoutes.js";
import { SESSION_HEADER, createSessionMiddleware } from "../../sessions/sessionMiddleware.js";
import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import { createVariantRouter } from "../variantRoutes.js";

// The route validates baseGameId against the engine registry. Register the
// built-ins once — guarded because the registry is a process-wide singleton and
// registering twice throws.
beforeAll(() => {
  if (!hasGame("nim")) {
    registerBuiltInGames();
    registerBuiltInRealtimeGames();
  }
});

describe("variant routes", () => {
  let store: Store;
  let server: Server;
  let baseUrl: string;

  async function listen(limit?: RateLimitFor): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use(createSessionMiddleware(store));
    const sink = createStoreSink(store.events);
    // Mount the share router too so the auto-minted link can be resolved.
    app.use("/api", createVariantRouter(store, sink, limit));
    app.use("/api", createShareRouter(store, sink, limit));

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a network address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  beforeEach(() => {
    store = createMemoryStore();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function save(token: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/variants`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: token },
      body: JSON.stringify(body),
    });
  }

  function resolve(shareToken: string): Promise<Response> {
    return fetch(`${baseUrl}/api/share/${shareToken}`, { method: "GET" });
  }

  it("saves a variant and auto-mints a durable share link (201)", async () => {
    await listen();
    const res = await save("sess-a", {
      baseGameId: "nim",
      name: "Neon Nim",
      cosmetics: { theme: "neon", piece: "orb" },
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      variant: { id: string; name: string; baseGameId: string; cosmetics: unknown };
      share: { token: string; kind: string; expiresAt: string | null };
    };
    expect(body.variant).toMatchObject({
      name: "Neon Nim",
      baseGameId: "nim",
      cosmetics: { theme: "neon", piece: "orb" },
    });
    expect(body.share.kind).toBe("variant");
    expect(body.share.token).toBeTruthy();
    // Durable: no expiry.
    expect(body.share.expiresAt).toBeNull();
    // The response never leaks the owner token.
    expect(JSON.stringify(body)).not.toContain("sess-a");

    // Persisted owner-scoped.
    const owned = await store.variants.findByOwner("sess-a");
    expect(owned).toHaveLength(1);
    expect(owned[0]!.id).toBe(body.variant.id);
  });

  it("emits a share_minted funnel event for the auto-minted link", async () => {
    await listen();
    await save("sess-a", { baseGameId: "nim", name: "Tracked", cosmetics: {} });
    const counts = await store.events.countByName(
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000),
    );
    const minted = counts.find((c) => c.name === "share_minted");
    expect(minted?.count).toBe(1);
  });

  it("resolves the auto-minted link to a spoiler-free public variant", async () => {
    await listen();
    const saved = (await (
      await save("owner-1", {
        baseGameId: "nim",
        name: "Shared Nim",
        cosmetics: { theme: "dark" },
      })
    ).json()) as { share: { token: string } };

    // A stranger (no session token needed — the link is the capability).
    const res = await resolve(saved.share.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kind: string;
      variant: { name: string; baseGameId: string; cosmetics: unknown; ownerToken?: string };
    };
    expect(body.kind).toBe("variant");
    expect(body.variant).toMatchObject({
      name: "Shared Nim",
      baseGameId: "nim",
      cosmetics: { theme: "dark" },
    });
    // Never the owner token, anywhere in the payload.
    expect(body.variant.ownerToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("owner-1");
  });

  it("accepts a realtime base game and an empty cosmetics map", async () => {
    await listen();
    const res = await save("sess-a", {
      baseGameId: "floppy-birds",
      name: "Just Named",
      cosmetics: {},
    });
    expect(res.status).toBe(201);
  });

  it("rejects an unregistered baseGameId (400), never 5xx", async () => {
    await listen();
    const res = await save("sess-a", { baseGameId: "no-such-game", name: "X", cosmetics: {} });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_VARIANT", reason: "baseGameId" });
    expect(await store.variants.findByOwner("sess-a")).toHaveLength(0);
  });

  it("rejects a missing baseGameId (400)", async () => {
    await listen();
    const res = await save("sess-a", { name: "X", cosmetics: {} });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_VARIANT", reason: "baseGameId" });
  });

  it("rejects a name that fails moderation (400 INVALID_VARIANT_NAME + reason)", async () => {
    await listen();
    // Empty after trim → EMPTY; over 40 chars → TOO_LONG.
    const empty = await save("sess-a", { baseGameId: "nim", name: "   ", cosmetics: {} });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "INVALID_VARIANT_NAME", reason: "EMPTY" });

    const long = await save("sess-a", {
      baseGameId: "nim",
      name: "x".repeat(41),
      cosmetics: {},
    });
    expect(await long.json()).toEqual({ error: "INVALID_VARIANT_NAME", reason: "TOO_LONG" });

    expect(await store.variants.findByOwner("sess-a")).toHaveLength(0);
  });

  it("trims the stored name to the moderated value", async () => {
    await listen();
    const res = await save("sess-a", { baseGameId: "nim", name: "  Padded  ", cosmetics: {} });
    expect(res.status).toBe(201);
    const [owned] = await store.variants.findByOwner("sess-a");
    expect(owned!.name).toBe("Padded");
  });

  it("rejects malformed cosmetics via the shape guard (400 with reason), never 5xx", async () => {
    await listen();
    const notObject = await save("sess-a", { baseGameId: "nim", name: "N", cosmetics: "nope" });
    expect(notObject.status).toBe(400);
    expect(await notObject.json()).toEqual({
      error: "INVALID_VARIANT",
      reason: "cosmetics_not_object",
    });

    const badValue = await save("sess-a", {
      baseGameId: "nim",
      name: "N",
      cosmetics: { theme: 42 },
    });
    expect(await badValue.json()).toEqual({
      error: "INVALID_VARIANT",
      reason: "cosmetics_value_not_string",
    });

    expect(await store.variants.findByOwner("sess-a")).toHaveLength(0);
  });

  it("enforces the variant_save rate policy", async () => {
    const throttle: RateLimitFor =
      (policy: string) => (_req: ExRequest, res: ExResponse, next: NextFunction) => {
        if (policy === "variant_save") {
          res.status(429).json({ code: "RATE_LIMITED" });
          return;
        }
        next();
      };
    await listen(throttle);

    const res = await save("sess-a", { baseGameId: "nim", name: "Rate", cosmetics: {} });
    expect(res.status).toBe(429);
    expect(await store.variants.findByOwner("sess-a")).toHaveLength(0);
  });
});
