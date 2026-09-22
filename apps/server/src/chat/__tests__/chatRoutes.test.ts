import type { Server } from "node:http";

import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRateLimiter, noopLimit } from "../../middleware/rateLimit.js";
import { createMemoryStore } from "../../store/memory/index.js";
import { SESSION_HEADER, createSessionMiddleware } from "../../sessions/sessionMiddleware.js";
import type { Store } from "../../store/ports.js";
import { createChatRouter } from "../chatRoutes.js";
import type { AblyClientOptions } from "../ably.js";

/** Build a fetch-compatible `Response` for a mocked `fetch`. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("chat routes (CHAT-002/003)", () => {
  let store: Store;
  let server: Server;
  let baseUrl: string;
  const originalApiKey = process.env["ABLY_API_KEY"];

  beforeEach(() => {
    delete process.env["ABLY_API_KEY"];
  });

  afterEach(async () => {
    if (originalApiKey === undefined) delete process.env["ABLY_API_KEY"];
    else process.env["ABLY_API_KEY"] = originalApiKey;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  /**
   * Stands up the chat router behind session middleware, with independent
   * mocked `fetch`es for the rate limiter (external service) and Ably (so a
   * test can trip one without the other, and neither ever hits the network).
   */
  async function mount(
    opts: {
      limitFetch?: typeof fetch;
      ablyOptions?: AblyClientOptions;
    } = {},
  ): Promise<{ call: (path: string, init?: RequestInit) => Promise<Response> }> {
    store = createMemoryStore();
    const limiter = opts.limitFetch
      ? createRateLimiter({ url: "http://limiter.test", fetchImpl: opts.limitFetch })
      : undefined;

    const app = express();
    app.use(express.json());
    app.use(createSessionMiddleware(store));
    app.use(
      "/api",
      createChatRouter(limiter ? limiter.limit.bind(limiter) : noopLimit, opts.ablyOptions ?? {}),
    );

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
          headers: {
            "content-type": "application/json",
            [SESSION_HEADER]: "tok-sender",
            ...(init.headers ?? {}),
          },
        }),
    };
  }

  describe("POST /api/chat/token", () => {
    it("degrades to 503 chat_unavailable when ABLY_API_KEY is unset", async () => {
      const { call } = await mount();
      const res = await call("/api/chat/token", {
        method: "POST",
        body: JSON.stringify({ roomId: "room-1" }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "chat_unavailable" });
    });

    it("rejects an invalid roomId", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: "keyName.abc:secret" } });
      const res = await call("/api/chat/token", {
        method: "POST",
        body: JSON.stringify({ roomId: "not a valid slug!" }),
      });
      expect(res.status).toBe(400);
    });

    it("mints a subscribe-only token scoped to exactly one channel", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse({ token: "opaque-token", clientId: "tok-sender" }));
      const { call } = await mount({
        ablyOptions: { apiKey: "keyName.abc:secret", fetchImpl },
      });

      const res = await call("/api/chat/token", {
        method: "POST",
        body: JSON.stringify({ roomId: "room-1" }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        tokenRequest: unknown;
        channelName: string;
        clientId: string;
      };
      expect(body.channelName).toBe("chat:room-1");
      expect(body.clientId).toBe("tok-sender");
      expect(body.tokenRequest).toEqual({ token: "opaque-token", clientId: "tok-sender" });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://rest.ably.io/keys/keyName.abc/requestToken");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(
        `Basic ${Buffer.from("keyName.abc:secret").toString("base64")}`,
      );
      const sent = JSON.parse(String(init.body)) as { capability: string; clientId: string };
      expect(JSON.parse(sent.capability)).toEqual({ "chat:room-1": ["subscribe"] });
      expect(sent.clientId).toBe("tok-sender");
    });

    it("degrades to 503 when Ably itself errors", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 401));
      const { call } = await mount({
        ablyOptions: { apiKey: "keyName.abc:secret", fetchImpl },
      });

      const res = await call("/api/chat/token", {
        method: "POST",
        body: JSON.stringify({ roomId: "room-1" }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "chat_unavailable" });
    });
  });

  describe("POST /api/chat/:roomId/messages", () => {
    function publishOk() {
      return vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    }

    it("degrades to 503 chat_unavailable when ABLY_API_KEY is unset", async () => {
      const { call } = await mount();
      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "Ann" }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "chat_unavailable" });
    });

    it("rejects empty text", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() } });
      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "   ", displayName: "Ann" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects text over the 500-char cap", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() } });
      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "a".repeat(501), displayName: "Ann" }),
      });
      expect(res.status).toBe(400);
    });

    it("accepts text at exactly the 500-char cap", async () => {
      const fetchImpl = publishOk();
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl } });
      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "a".repeat(500), displayName: "Ann" }),
      });
      expect(res.status).toBe(202);
    });

    it("rejects an empty or over-cap displayName", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() } });

      const empty = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "  " }),
      });
      expect(empty.status).toBe(400);

      const tooLong = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "n".repeat(41) }),
      });
      expect(tooLong.status).toBe(400);
    });

    it("rejects an invalid roomId", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() } });
      const res = await call("/api/chat/not valid!/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "Ann" }),
      });
      expect(res.status).toBe(400);
    });

    it("publishes a server-authoritative message, deriving sender from the session (not the body)", async () => {
      const fetchImpl = publishOk();
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl } });

      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({
          text: "hello there",
          displayName: "Ann",
          sender: { token: "someone-else", name: "Forged" }, // must be ignored
        }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { id: string; ts: number };
      expect(typeof body.id).toBe("string");
      expect(typeof body.ts).toBe("number");

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `https://rest.ably.io/channels/${encodeURIComponent("chat:room-1")}/messages`,
      );
      const sent = JSON.parse(String(init.body)) as {
        name: string;
        data: {
          id: string;
          roomId: string;
          sender: { token: string; name: string };
          text: string;
          ts: number;
        };
      };
      expect(sent.name).toBe("message");
      expect(sent.data.roomId).toBe("room-1");
      expect(sent.data.sender).toEqual({ token: "tok-sender", name: "Ann" });
      expect(sent.data.text).toBe("hello there");
      expect(sent.data.id).toBe(body.id);
      expect(sent.data.ts).toBe(body.ts);
    });

    it("honors a well-formed client-minted id, so the sender's optimistic bubble reconciles", async () => {
      const fetchImpl = publishOk();
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl } });

      const clientId = "123e4567-e89b-42d3-a456-426614174000";
      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ id: clientId, text: "hello there", displayName: "Ann" }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe(clientId);

      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      const sent = JSON.parse(String(init.body)) as { data: { id: string } };
      expect(sent.data.id).toBe(clientId);
    });

    it("ignores a malformed client id and mints its own", async () => {
      const fetchImpl = publishOk();
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl } });

      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ id: "not-a-uuid; drop table", text: "hi", displayName: "Ann" }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { id: string };
      expect(body.id).not.toBe("not-a-uuid; drop table");
      expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("masks profanity in the text before publishing", async () => {
      const fetchImpl = publishOk();
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl } });

      await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "you are a fuck", displayName: "Ann" }),
      });

      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      const sent = JSON.parse(String(init.body)) as { data: { text: string } };
      expect(sent.data.text).toBe("you are a ****");
    });

    it("degrades to 503 when Ably publish fails", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl } });

      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "Ann" }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "chat_unavailable" });
    });

    it("rate-limits on the session token via the shared in-house limiter, returning 429", async () => {
      const limitFetch = vi
        .fn()
        .mockResolvedValue(jsonResponse({ outcome: "OUTCOME_THROTTLED", retryAfter: 5 }));
      const publishFetch = publishOk();
      const { call } = await mount({
        limitFetch,
        ablyOptions: { apiKey: "k:s", fetchImpl: publishFetch },
      });

      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "Ann" }),
      });
      expect(res.status).toBe(429);
      // Never reaches Ably once throttled.
      expect(publishFetch).not.toHaveBeenCalled();

      // The limiter was consulted keyed on the caller's session token.
      const [, limitInit] = limitFetch.mock.calls[0] as [string, RequestInit];
      const sent = JSON.parse(String(limitInit.body)) as {
        buckets: { bucket: { policy: string; dimension: string; id: string } }[];
      };
      expect(sent.buckets[0]?.bucket).toEqual({
        policy: "chat_message",
        dimension: "session",
        id: "tok-sender",
      });
    });
  });
});
