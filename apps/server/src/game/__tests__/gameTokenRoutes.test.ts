import type { Server } from "node:http";

import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { noopLimit } from "../../middleware/rateLimit.js";
import type { AblyClientOptions } from "../../chat/ably.js";
import { createGameRouter } from "../gameTokenRoutes.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/game/token", () => {
  let server: Server;
  let baseUrl: string;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function mount(ablyOptions: AblyClientOptions = {}) {
    const app = express();
    app.use(express.json());
    app.use("/api", createGameRouter(noopLimit, ablyOptions));

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    return {
      call: (path: string, init: RequestInit = {}) =>
        fetch(`${baseUrl}${path}`, {
          ...init,
          headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        }),
    };
  }

  it("degrades to 503 game_unavailable when no API key is configured", async () => {
    const { call } = await mount();
    const res = await call("/api/game/token", {
      method: "POST",
      body: JSON.stringify({ roomId: "room-1", secret: "royal" }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "game_unavailable" });
  });

  it("rejects an invalid roomId", async () => {
    const { call } = await mount({ apiKey: "keyName.abc:secret" });
    const res = await call("/api/game/token", {
      method: "POST",
      body: JSON.stringify({ roomId: "not a valid slug!", secret: "royal" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ROOM_ID" });
  });

  it("rejects a missing/blank secret — every online room is private", async () => {
    const { call } = await mount({ apiKey: "keyName.abc:secret" });
    const res = await call("/api/game/token", {
      method: "POST",
      body: JSON.stringify({ roomId: "room-1" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_SECRET" });
  });

  it("mints a subscribe+publish token scoped to the secret-derived channel", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ token: "opaque-token", clientId: "peer-1" }));
    const { call } = await mount({ apiKey: "keyName.abc:secret", fetchImpl });

    const res = await call("/api/game/token", {
      method: "POST",
      body: JSON.stringify({ roomId: "room-1", secret: "royal", clientId: "peer-1" }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      tokenRequest: unknown;
      channelName: string;
      clientId: string;
    };
    expect(body.channelName).toMatch(/^game:p-[0-9a-f]{32}$/);
    expect(body.clientId).toBe("peer-1");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body)) as { capability: string; clientId: string };
    expect(JSON.parse(sent.capability)).toEqual({ [body.channelName]: ["subscribe", "publish"] });
    expect(sent.clientId).toBe("peer-1");
  });

  it("derives the same channel for both peers given the same roomId+secret", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ token: "opaque-token", clientId: "x" })),
      );
    const { call } = await mount({ apiKey: "keyName.abc:secret", fetchImpl });

    const a = await call("/api/game/token", {
      method: "POST",
      body: JSON.stringify({ roomId: "room-1", secret: "royal", clientId: "creator" }),
    });
    const b = await call("/api/game/token", {
      method: "POST",
      body: JSON.stringify({ roomId: "room-1", secret: "royal", clientId: "joiner" }),
    });
    const results = (await Promise.all([a.json(), b.json()])) as { channelName: string }[];
    const [bodyA, bodyB] = results;
    expect(bodyA?.channelName).toBe(bodyB?.channelName);
    expect(bodyA?.channelName).toBeTruthy();
  });

  it("degrades to 503 game_unavailable when the Ably request fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 500));
    const { call } = await mount({ apiKey: "keyName.abc:secret", fetchImpl });

    const res = await call("/api/game/token", {
      method: "POST",
      body: JSON.stringify({ roomId: "room-1", secret: "royal" }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "game_unavailable" });
  });
});
