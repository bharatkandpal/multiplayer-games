import type { Server } from "node:http";

import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRateLimiter, noopLimit } from "../../middleware/rateLimit.js";
import { createMemoryStore } from "../../store/memory/index.js";
import { createMemoryChatRoomRepo } from "../../store/memory/chat-room-repo.memory.js";
import { SESSION_HEADER, createSessionMiddleware } from "../../sessions/sessionMiddleware.js";
import type { ChatRoom, Store } from "../../store/ports.js";
import { createChatRouter } from "../chatRoutes.js";
import type { ChatHistoryQueueOptions } from "../historyQueue.js";
import { channelNameFor } from "../privateChannel.js";
import type { AblyClientOptions } from "../ably.js";

/** Build a fetch-compatible `Response` for a mocked `fetch`. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The registry these tests act against: one public room, one private one. */
const TEST_ROOMS: readonly ChatRoom[] = [
  { id: "room-1", label: "Room One", visibility: "public", secret: null, sortOrder: 0 },
  { id: "room-p", label: "Private", visibility: "private", secret: "royal", sortOrder: 1 },
];

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
      /** Make the history store throw, to prove send/history degrade rather than 500. */
      breakChatStore?: boolean;
      /** Override the seeded room registry (defaults to {@link TEST_ROOMS}). */
      rooms?: readonly ChatRoom[];
      /** Make the room registry throw, to prove chat degrades rather than 500s. */
      breakRoomRegistry?: boolean;
      /** History-queue overrides (CHAT-023). Defaults to a zero-delay window so
       *  a test only has to wait for the write, not for the batching window. */
      history?: ChatHistoryQueueOptions;
    } = {},
  ): Promise<{ call: (path: string, init?: RequestInit) => Promise<Response> }> {
    store = createMemoryStore();
    // Rooms are administrator-owned (CHAT-022), so tests declare the room set
    // they act on rather than inventing ids in the URL. A room is public *or*
    // private — never both — so the private cases use their own room.
    store = {
      ...store,
      chatRooms: opts.breakRoomRegistry
        ? {
            list: () => Promise.reject(new Error("registry down")),
            get: () => Promise.reject(new Error("registry down")),
          }
        : createMemoryChatRoomRepo(opts.rooms ?? TEST_ROOMS),
    };
    if (opts.breakChatStore) {
      const boom = (): never => {
        throw new Error("chat store down");
      };
      store = {
        ...store,
        chat: {
          append: boom,
          page: boom,
          deleteByOwner: boom,
          deleteOlderThan: boom,
        },
      };
    }
    const limiter = opts.limitFetch
      ? createRateLimiter({ url: "http://limiter.test", fetchImpl: opts.limitFetch })
      : undefined;

    const app = express();
    app.use(express.json());
    app.use(createSessionMiddleware(store));
    app.use(
      "/api",
      createChatRouter(
        store,
        limiter ? limiter.limit.bind(limiter) : noopLimit,
        opts.ablyOptions ?? {},
        opts.history ?? { flushDelayMs: 0 },
      ),
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

    it("scopes a private room's token to an opaque, secret-derived channel", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse({ token: "opaque-token", clientId: "tok-sender" }));
      const { call } = await mount({
        ablyOptions: { apiKey: "keyName.abc:secret", fetchImpl },
      });

      const res = await call("/api/chat/token", {
        method: "POST",
        body: JSON.stringify({ roomId: "room-p", secret: "royal" }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { channelName: string };
      // Not the public `chat:room-1` — a private hash the secret alone unlocks.
      expect(body.channelName).toMatch(/^chat:p-[0-9a-f]{32}$/);
      expect(body.channelName).not.toBe("chat:room-p");

      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      const sent = JSON.parse(String(init.body)) as { capability: string };
      // The token grants subscribe on exactly (and only) that private channel.
      expect(JSON.parse(sent.capability)).toEqual({ [body.channelName]: ["subscribe"] });
    });

    it("rejects a malformed secret", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: "keyName.abc:secret" } });
      const res = await call("/api/chat/token", {
        method: "POST",
        body: JSON.stringify({ roomId: "room-1", secret: "x".repeat(129) }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_SECRET" });
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

    it("publishes a private-room message to the same secret-derived channel the token was scoped to", async () => {
      const fetchImpl = publishOk();
      const { call } = await mount({ ablyOptions: { apiKey: "keyName.abc:secret", fetchImpl } });

      const res = await call("/api/chat/room-p/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "Ann", secret: "royal" }),
      });
      expect(res.status).toBe(202);

      // The publish target must match the channel the token endpoint scopes a
      // token to for the same (roomId, secret) — both derive it identically, or
      // a sender would publish where no subscriber is listening. With no
      // `CHAT_PRIVATE_ROOM_KEY` set, the HMAC key is the resolved Ably key.
      const expected = channelNameFor("room-p", "royal", "keyName.abc:secret");
      expect(expected).toMatch(/^chat:p-[0-9a-f]{32}$/);
      const [url] = fetchImpl.mock.calls[0] as [string];
      expect(url).toBe(`https://rest.ably.io/channels/${encodeURIComponent(expected)}/messages`);
    });

    it("rejects a malformed secret", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() } });
      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "Ann", secret: "x".repeat(129) }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_SECRET" });
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

    it("persists a delivered message for history, keyed by the derived channel", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() } });

      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "Ann" }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { id: string; ts: number };

      // Written behind the response (CHAT-023), so wait for the flush rather
      // than assuming the row exists the instant the sender is answered.
      const stored = await vi.waitFor(async () => {
        const rows = await store.chat.page("chat:room-1", { limit: 10 });
        expect(rows).toHaveLength(1);
        return rows;
      });
      expect(stored[0]).toMatchObject({
        id: body.id,
        channel: "chat:room-1",
        roomId: "room-1",
        senderToken: "tok-sender",
        senderName: "Ann",
        text: "hi",
        ts: body.ts,
      });
    });

    it("persists a private-room message under its opaque channel, never the secret", async () => {
      const { call } = await mount({
        ablyOptions: { apiKey: "keyName.abc:secret", fetchImpl: publishOk() },
      });

      await call("/api/chat/room-p/messages", {
        method: "POST",
        body: JSON.stringify({ text: "psst", displayName: "Ann", secret: "royal" }),
      });

      const channel = channelNameFor("room-p", "royal", "keyName.abc:secret");
      const stored = await vi.waitFor(async () => {
        const rows = await store.chat.page(channel, { limit: 10 });
        expect(rows).toHaveLength(1);
        return rows;
      });
      expect(stored[0]?.channel).toBe(channel);
      // The public room's channel never sees it, and the secret itself is
      // nowhere in the stored row.
      expect(await store.chat.page("chat:room-1", { limit: 10 })).toHaveLength(0);
      expect(JSON.stringify(stored)).not.toContain("royal");
    });

    it("answers the sender without waiting for the history write (CHAT-023)", async () => {
      // A store that never resolves stands in for a slow one: with history on
      // the request path this send could not return at all.
      let release: (() => void) | undefined;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { call } = await mount({
        ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() },
      });
      store.chat.append = () => blocked;
      store.chat.appendMany = () => blocked;

      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "Ann" }),
      });

      // Delivered live and acknowledged while the write is still pending.
      expect(res.status).toBe(202);
      release?.();
    });

    it("still delivers (202) when persistence throws — history degrades, the message doesn't", async () => {
      const fetchImpl = publishOk();
      const { call } = await mount({
        ablyOptions: { apiKey: "k:s", fetchImpl },
        breakChatStore: true,
      });

      const res = await call("/api/chat/room-1/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "Ann" }),
      });
      // The publish (live delivery) succeeded, so the send is a 202 even though
      // the store blew up — a downed history store must never fail a send.
      expect(res.status).toBe(202);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /api/chat/:roomId/history (CHAT-021)", () => {
    function publishOk() {
      return vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    }

    /** Seed `count` messages into `room` (optionally private) via the send endpoint. */
    async function seed(
      call: (path: string, init?: RequestInit) => Promise<Response>,
      room: string,
      count: number,
      secret?: string,
    ): Promise<void> {
      for (let i = 0; i < count; i++) {
        const res = await call(`/api/chat/${room}/messages`, {
          method: "POST",
          body: JSON.stringify({
            text: `m${i}`,
            displayName: "Ann",
            ...(secret ? { secret } : {}),
          }),
        });
        expect(res.status).toBe(202);
      }
      // Sends are answered before history is written (CHAT-023), so a test that
      // reads the transcript back has to wait for the queue to catch up.
      await vi.waitFor(async () => {
        const channel = secret
          ? channelNameFor(room, secret, "keyName.abc:secret")
          : `chat:${room}`;
        expect(await store.chat.page(channel, { limit: count + 1 })).toHaveLength(count);
      });
    }

    it("degrades to 503 when ABLY_API_KEY is unset", async () => {
      const { call } = await mount();
      const res = await call("/api/chat/room-1/history", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(503);
    });

    it("returns the newest page oldest-first, with hasMore and a cursor", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() } });
      await seed(call, "room-1", 12);

      const res = await call("/api/chat/room-1/history", {
        method: "POST",
        body: JSON.stringify({ limit: 10 }),
      });
      expect(res.status).toBe(200);
      const page = (await res.json()) as {
        messages: { text: string; ts: number }[];
        hasMore: boolean;
        cursor: { ts: number; id: string } | null;
      };
      expect(page.messages).toHaveLength(10);
      // Oldest-first within the page: ascending ts.
      const times = page.messages.map((m) => m.ts);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      // 12 seeded, 10 returned → an older page exists.
      expect(page.hasMore).toBe(true);
      expect(page.cursor).not.toBeNull();
    });

    it("pages strictly older than the cursor on scroll-up", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() } });
      await seed(call, "room-1", 12);

      const first = (await (
        await call("/api/chat/room-1/history", {
          method: "POST",
          body: JSON.stringify({ limit: 10 }),
        })
      ).json()) as { messages: { id: string }[]; cursor: { ts: number; id: string } };

      const older = (await (
        await call("/api/chat/room-1/history", {
          method: "POST",
          body: JSON.stringify({ limit: 10, before: first.cursor }),
        })
      ).json()) as { messages: { id: string }[]; hasMore: boolean };

      // The remaining 2 older messages, and no overlap with the first page.
      expect(older.messages).toHaveLength(2);
      expect(older.hasMore).toBe(false);
      const firstIds = new Set(first.messages.map((m) => m.id));
      expect(older.messages.every((m) => !firstIds.has(m.id))).toBe(true);
    });

    it("gates a private room's history on its room code", async () => {
      const { call } = await mount({
        ablyOptions: { apiKey: "keyName.abc:secret", fetchImpl: publishOk() },
      });
      await seed(call, "room-p", 3, "royal");

      const right = (await (
        await call("/api/chat/room-p/history", {
          method: "POST",
          body: JSON.stringify({ secret: "royal" }),
        })
      ).json()) as { messages: unknown[] };
      expect(right.messages).toHaveLength(3);

      // Before the registry (CHAT-022) a wrong or missing code quietly returned
      // an empty page from a different derived channel. Now the transcript is
      // refused outright — and the room's own public channel holds nothing.
      for (const body of [{}, { secret: "flush" }]) {
        const res = await call("/api/chat/room-p/history", {
          method: "POST",
          body: JSON.stringify(body),
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "BAD_SECRET" });
      }

      const publicView = (await (
        await call("/api/chat/room-1/history", { method: "POST", body: JSON.stringify({}) })
      ).json()) as { messages: unknown[] };
      expect(publicView.messages).toHaveLength(0);
    });

    it("rejects a malformed secret", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() } });
      const res = await call("/api/chat/room-1/history", {
        method: "POST",
        body: JSON.stringify({ secret: "x".repeat(129) }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_SECRET" });
    });

    it("degrades to 503 when the history store throws", async () => {
      const { call } = await mount({
        ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() },
        breakChatStore: true,
      });
      const res = await call("/api/chat/room-1/history", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "chat_unavailable" });
    });
  });

  describe("the room registry (CHAT-022)", () => {
    const ABLY = "keyName.abc:secret";

    function publishOk() {
      return vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    }

    it("refuses a room that is not in the registry", async () => {
      const { call } = await mount({ ablyOptions: { apiKey: ABLY, fetchImpl: publishOk() } });

      // Slug-shaped and previously enough to mint a token — rooms are now a
      // closed, administrator-owned set.
      const token = await call("/api/chat/token", {
        method: "POST",
        body: JSON.stringify({ roomId: "invented-room" }),
      });
      expect(token.status).toBe(404);
      expect(await token.json()).toEqual({ error: "UNKNOWN_ROOM" });

      const send = await call("/api/chat/invented-room/messages", {
        method: "POST",
        body: JSON.stringify({ text: "hi", displayName: "Ann" }),
      });
      expect(send.status).toBe(404);
    });

    it("refuses a private room without, or with the wrong, code", async () => {
      const fetchImpl = publishOk();
      const { call } = await mount({ ablyOptions: { apiKey: ABLY, fetchImpl } });

      for (const body of [{ roomId: "room-p" }, { roomId: "room-p", secret: "nope" }]) {
        const res = await call("/api/chat/token", { method: "POST", body: JSON.stringify(body) });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "BAD_SECRET" });
      }
      // No token was minted, so Ably was never called on a refused attempt.
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("ignores a secret sent to a public room rather than erroring", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ token: "t", clientId: "c" }));
      const { call } = await mount({ ablyOptions: { apiKey: ABLY, fetchImpl } });

      const res = await call("/api/chat/token", {
        method: "POST",
        body: JSON.stringify({ roomId: "room-1", secret: "stale" }),
      });
      expect(res.status).toBe(200);
      // The public channel, not a secret-derived one — a stale client that
      // still sends a code can't lock itself out of a public room.
      expect(((await res.json()) as { channelName: string }).channelName).toBe("chat:room-1");
    });

    it("resolves the legacy `lobby` id to the first room", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ token: "t", clientId: "c" }));
      const { call } = await mount({ ablyOptions: { apiKey: ABLY, fetchImpl } });

      const res = await call("/api/chat/token", {
        method: "POST",
        body: JSON.stringify({ roomId: "lobby" }),
      });
      expect(res.status).toBe(200);
      // Already-shared `/chat/lobby` links keep working, landing on the default
      // room's channel rather than 404-ing or a channel of their own.
      expect(((await res.json()) as { channelName: string }).channelName).toBe("chat:room-1");
    });
  });

  describe("GET /api/chat/rooms (CHAT-022)", () => {
    function publishOk() {
      return vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    }

    it("lists rooms without ever exposing a room code", async () => {
      const { call } = await mount();
      const res = await call("/api/chat/rooms");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { rooms: { id: string; visibility: string }[] };
      expect(body.rooms.map((r) => r.id)).toEqual(["room-1", "room-p"]);
      expect(body.rooms.find((r) => r.id === "room-p")?.visibility).toBe("private");
      // The private room is listed by name, but its code never crosses the wire.
      expect(JSON.stringify(body)).not.toContain("royal");
      expect(JSON.stringify(body)).not.toContain("secret");
    });

    it("omits counts entirely when occupancy is unavailable", async () => {
      // No ABLY_API_KEY: the list still renders. An absent `active` is honest;
      // a zero would claim the room is empty.
      const { call } = await mount();
      const body = (await (await call("/api/chat/rooms")).json()) as {
        rooms: Record<string, unknown>[];
      };
      expect(body.rooms).toHaveLength(2);
      expect(body.rooms.every((r) => !("active" in r))).toBe(true);
    });

    it("attaches subscriber counts, matching a private room by derived channel", async () => {
      const privateChannel = channelNameFor("room-p", "royal", "keyName.abc:secret");
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse([
          { channelId: "chat:room-1", status: { occupancy: { metrics: { subscribers: 7 } } } },
          { channelId: privateChannel, status: { occupancy: { metrics: { subscribers: 2 } } } },
        ]),
      );
      const { call } = await mount({
        ablyOptions: { apiKey: "keyName.abc:secret", fetchImpl },
      });

      const body = (await (await call("/api/chat/rooms")).json()) as {
        rooms: { id: string; active: number }[];
      };
      expect(body.rooms).toEqual([
        { id: "room-1", label: "Room One", visibility: "public", active: 7 },
        { id: "room-p", label: "Private", visibility: "private", active: 2 },
      ]);
    });

    it("reports a room absent from enumeration as zero, not missing", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
      const { call } = await mount({
        ablyOptions: { apiKey: "keyName.abc:secret", fetchImpl },
      });
      const body = (await (await call("/api/chat/rooms")).json()) as {
        rooms: { id: string; active: number }[];
      };
      // Enumeration only returns *active* channels; for a room the registry
      // vouches for, absent means nobody is connected.
      expect(body.rooms.map((r) => r.active)).toEqual([0, 0]);
    });

    it("still lists rooms when Ably enumeration fails", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 401));
      const { call } = await mount({
        ablyOptions: { apiKey: "keyName.abc:secret", fetchImpl },
      });
      const res = await call("/api/chat/rooms");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rooms: Record<string, unknown>[] };
      expect(body.rooms).toHaveLength(2);
      expect(body.rooms.every((r) => !("active" in r))).toBe(true);
    });

    it("returns an empty list for an empty registry, not an error", async () => {
      const { call } = await mount({ rooms: [] });
      const res = await call("/api/chat/rooms");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ rooms: [] });
    });

    it("degrades to 503 when the registry itself is unreachable", async () => {
      const { call } = await mount({
        breakRoomRegistry: true,
        ablyOptions: { apiKey: "k:s", fetchImpl: publishOk() },
      });

      // A registry that throws degrades like every other chat failure — the
      // client renders no rail, and the game is untouched.
      const list = await call("/api/chat/rooms");
      expect(list.status).toBe(503);
      expect(await list.json()).toEqual({ error: "chat_unavailable" });

      // The same is true of joining: a database error must not become a 500.
      const token = await call("/api/chat/token", {
        method: "POST",
        body: JSON.stringify({ roomId: "room-1" }),
      });
      expect(token.status).toBe(503);
      expect(await token.json()).toEqual({ error: "chat_unavailable" });
    });
  });
});
