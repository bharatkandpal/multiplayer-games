/**
 * Server-authoritative Ably chat endpoints (CHAT-002/003).
 *
 * ADR 0005: the server is the only Ably publisher; clients only ever
 * subscribe. Chat is ephemeral — no durable store, no transcript — so this
 * file's whole job is (a) minting a per-room, subscribe-only Ably token and
 * (b) validating + moderating + publishing one message at a time. There is
 * nothing else: no history endpoint, no read receipts, nothing that would
 * make this the source of truth for anything past "right now".
 *
 * Offline pillar (CLAUDE.md / docs/UX_PRINCIPLES.md §7): chat is a pure
 * enhancement layered on top of a game that already works without it. If
 * `ABLY_API_KEY` is unset, or Ably itself errors, both endpoints degrade to
 * `503 { error: "chat_unavailable" }` — never a 500, never an uncaught
 * throw — so the client can degrade to "no chat panel" instead of an error
 * banner over a game the player didn't ask to chat in.
 */

import { timingSafeEqual } from "node:crypto";

import { Router } from "express";
import type { Request, Response } from "express";

import { noopLimit, type RateLimitFor } from "../middleware/rateLimit.js";
import type { ChatCursor, ChatRoom, ChatStoredMessage, Store } from "../store/ports.js";
import {
  requestAblyToken,
  publishAblyMessage,
  getAblyApiKey,
  fetchChannelOccupancy,
  type AblyClientOptions,
} from "./ably.js";
import { createChatHistoryQueue, type ChatHistoryQueueOptions } from "./historyQueue.js";
import { channelNameFor, normalizeRoomSecret } from "./privateChannel.js";
import { maskProfanity } from "./profanityMask.js";

/** Matches the "safe slug" a room id already is (see rooms/RoomManager.ts ids). */
const ROOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * A client-minted message id (CHAT-018): a v4-shaped UUID. Accepted only in
 * this exact shape so the id stays an opaque, collision-free handle the sender
 * chose for its own optimistic bubble — never a vector for injecting arbitrary
 * strings into the broadcast. Anything else falls back to a server-minted id.
 */
const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_TEXT_LENGTH = 500;
const MAX_DISPLAY_NAME_LENGTH = 40;

/** Default and ceiling for a single history page (CHAT-021). */
const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 50;

function isValidRoomId(value: unknown): value is string {
  return typeof value === "string" && ROOM_ID_RE.test(value);
}

/**
 * The `chat:new`-shaped message the wire (Ably broadcast and history reads)
 * both speak — the client reconciles the two by `id`, so their shapes must
 * match exactly.
 */
function toWireMessage(row: ChatStoredMessage): {
  id: string;
  roomId: string;
  sender: { token: string; name: string };
  text: string;
  ts: number;
} {
  return {
    id: row.id,
    roomId: row.roomId,
    sender: { token: row.senderToken, name: row.senderName },
    text: row.text,
    ts: row.ts,
  };
}

/** Parse a client-supplied history cursor; anything malformed pages from newest. */
function parseCursor(raw: unknown): ChatCursor | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { ts, id } = raw as { ts?: unknown; id?: unknown };
  if (typeof ts !== "number" || !Number.isFinite(ts) || typeof id !== "string") return undefined;
  return { ts, id };
}

/**
 * The key the private-room channel HMAC is derived under. A dedicated env wins
 * so it can be rotated independently, but it falls back to the resolved Ably
 * key — always present when chat is enabled, stable per deployment, and secret
 * — so private rooms work out of the box with no extra configuration.
 */
function privateRoomKey(resolvedApiKey: string): string {
  const dedicated = process.env["CHAT_PRIVATE_ROOM_KEY"];
  return typeof dedicated === "string" && dedicated.length > 0 ? dedicated : resolvedApiKey;
}

/** Constant-time string compare, so a room code can't be probed byte-by-byte. */
function secretMatches(supplied: string, stored: string): boolean {
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(stored, "utf8");
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length — compare against a same-length buffer and fold the length check in.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * The outcome of turning `(roomId, supplied secret)` into a channel to act on.
 * Every chat endpoint goes through this, so the registry is a single gate
 * rather than three copies of the same checks.
 */
type RoomResolution =
  | { readonly ok: true; readonly room: ChatRoom; readonly channelName: string }
  | { readonly ok: false; readonly status: number; readonly error: string };

/**
 * Resolve a request's room against the registry (CHAT-022).
 *
 * Rooms are administrator-owned, so an id that isn't in the table is a 404 —
 * where it used to mint a token for any slug-shaped string. Private rooms are
 * gated on the stored room code here; previously a wrong secret silently
 * derived a *different* channel and the caller saw an empty room, which was
 * unguessable but also indistinguishable from "nobody has spoken yet".
 *
 * The channel is still derived, never stored, and always from the room's
 * **canonical** id and stored secret — so the legacy `lobby` alias resolves to
 * the default room's channel, and a secret that differs only in whitespace
 * can't split a room across two channels.
 */
async function resolveRoom(
  store: Store,
  roomId: string,
  rawSecret: unknown,
  hmacKey: string,
): Promise<RoomResolution> {
  const supplied = normalizeRoomSecret(rawSecret);
  if (!supplied.ok) return { ok: false, status: 400, error: "INVALID_SECRET" };

  let room: ChatRoom | null;
  try {
    room = await store.chatRooms.get(roomId);
  } catch (err) {
    // The registry is unreachable — chat degrades to absence, like every other
    // chat failure, rather than surfacing a database error.
    console.error("[chat] room lookup failed", err);
    return { ok: false, status: 503, error: "chat_unavailable" };
  }

  if (!room) return { ok: false, status: 404, error: "UNKNOWN_ROOM" };

  if (room.visibility === "public") {
    // A public room has no code; any secret sent alongside is ignored rather
    // than treated as an error, so a stale client can't lock itself out.
    return { ok: true, room, channelName: channelNameFor(room.id, null, hmacKey) };
  }

  // Private. A room marked private with no stored code is a misconfiguration —
  // refuse rather than fall through to the public channel.
  if (room.secret === null || room.secret.length === 0) {
    console.error(`[chat] private room ${room.id} has no secret configured`);
    return { ok: false, status: 503, error: "chat_unavailable" };
  }
  if (supplied.secret === null || !secretMatches(supplied.secret, room.secret)) {
    return { ok: false, status: 403, error: "BAD_SECRET" };
  }
  return { ok: true, room, channelName: channelNameFor(room.id, room.secret, hmacKey) };
}

interface TokenRequestBody {
  readonly roomId?: unknown;
  readonly secret?: unknown;
}

interface SendMessageBody {
  readonly id?: unknown;
  readonly text?: unknown;
  readonly displayName?: unknown;
  readonly secret?: unknown;
}

interface HistoryRequestBody {
  readonly secret?: unknown;
  readonly before?: unknown;
  readonly limit?: unknown;
}

/**
 * `ablyOptions` exists purely so tests can inject a fake `fetch` and/or a
 * fake API key without touching `process.env` — production call sites
 * (`apiApp.ts`) never pass it, so the real endpoints/env are used.
 */
export function createChatRouter(
  store: Store,
  limit: RateLimitFor = noopLimit,
  ablyOptions: AblyClientOptions = {},
  historyOptions: ChatHistoryQueueOptions = {},
): Router {
  const router = Router();

  // Durable history is written behind the request (CHAT-023) — see
  // `historyQueue.ts`. Delivery is the Ably publish below; this only decides
  // when the transcript catches up.
  const history = createChatHistoryQueue(store.chat, historyOptions);

  /**
   * The lobby list is polled by every open client, so it is cached per router
   * instance — one Ably enumeration serves every caller in the window. Short
   * enough that a room filling up shows within a poll or two; long enough that
   * N clients don't mean N enumerations.
   */
  const ROOM_LIST_CACHE_MS = 15_000;
  let cachedRooms: { at: number; payload: unknown[] } | null = null;

  // POST /api/chat/token — mint a subscribe-only token scoped to exactly one room's channel.
  router.post("/chat/token", limit("chat_token"), async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const apiKey = ablyOptions.apiKey ?? getAblyApiKey();
    if (!apiKey) {
      res.status(503).json({ error: "chat_unavailable" });
      return;
    }

    const body = req.body as TokenRequestBody | undefined;
    const roomId = body?.roomId;
    if (!isValidRoomId(roomId)) {
      res.status(400).json({ error: "INVALID_ROOM_ID" });
      return;
    }

    // The registry decides whether this room exists and, for a private room,
    // whether the caller's code is right — before any token is minted.
    const resolved = await resolveRoom(store, roomId, body?.secret, privateRoomKey(apiKey));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    const { channelName } = resolved;

    try {
      // Subscribe-only, scoped to exactly this one channel — never "*", never publish.
      const tokenRequest = await requestAblyToken(
        { [channelName]: ["subscribe"] },
        token,
        ablyOptions,
      );
      res.status(200).json({ tokenRequest, channelName, clientId: token });
    } catch (err) {
      console.error("[chat] token mint failed", err);
      res.status(503).json({ error: "chat_unavailable" });
    }
  });

  // POST /api/chat/:roomId/messages — validate, rate-limit, mask, and publish one message.
  router.post(
    "/chat/:roomId/messages",
    limit("chat_message"),
    async (req: Request, res: Response) => {
      const senderToken = req.sessionToken;
      if (!senderToken) {
        res.status(400).json({ error: "no_session" });
        return;
      }

      const apiKey = ablyOptions.apiKey ?? getAblyApiKey();
      if (!apiKey) {
        res.status(503).json({ error: "chat_unavailable" });
        return;
      }

      const roomId = req.params["roomId"];
      if (!isValidRoomId(roomId)) {
        res.status(400).json({ error: "INVALID_ROOM_ID" });
        return;
      }

      const body = req.body as SendMessageBody | undefined;

      // Same gate as the token endpoint: unknown room → 404, wrong code → 403.
      // A caller cannot publish into a private room without its code, even
      // holding a valid session.
      const resolved = await resolveRoom(store, roomId, body?.secret, privateRoomKey(apiKey));
      if (!resolved.ok) {
        res.status(resolved.status).json({ error: resolved.error });
        return;
      }
      const { channelName } = resolved;

      const rawText = body?.text;
      const rawDisplayName = body?.displayName;

      const text = typeof rawText === "string" ? rawText.trim() : "";
      const displayName = typeof rawDisplayName === "string" ? rawDisplayName.trim() : "";

      if (text.length === 0 || text.length > MAX_TEXT_LENGTH) {
        res.status(400).json({ error: "INVALID_TEXT" });
        return;
      }
      if (displayName.length === 0 || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
        res.status(400).json({ error: "INVALID_DISPLAY_NAME" });
        return;
      }

      // Honor a well-formed client-minted id (CHAT-018) so the sender's
      // optimistic bubble reconciles against this broadcast; otherwise mint one.
      const rawId = body?.id;
      const id =
        typeof rawId === "string" && CLIENT_ID_RE.test(rawId) ? rawId : crypto.randomUUID();

      const message = {
        id,
        // The registry's canonical id, so a message sent via the legacy `lobby`
        // alias is broadcast and stored as the room it actually landed in.
        roomId: resolved.room.id,
        // Sender identity comes from the session, never the request body — a
        // caller cannot claim to be someone else's session token.
        sender: { token: senderToken, name: displayName },
        text: maskProfanity(text),
        ts: Date.now(),
      };

      try {
        await publishAblyMessage(channelName, message, ablyOptions);
      } catch (err) {
        console.error("[chat] publish failed", err);
        res.status(503).json({ error: "chat_unavailable" });
        return;
      }

      // Persist for history (CHAT-021) — strictly best-effort and, since
      // CHAT-023, off the request path entirely: the message is already
      // delivered live over Ably, so the transcript can catch up a window
      // later. A store outage degrades history to absence and never turns a
      // delivered message into a 503 (or into a slow send). Keyed by the
      // derived channel (a private room groups by its opaque hash); the secret
      // is never stored.
      await history.enqueue({
        id: message.id,
        channel: channelName,
        roomId: resolved.room.id,
        senderToken: message.sender.token,
        senderName: message.sender.name,
        text: message.text,
        ts: message.ts,
      });

      res.status(202).json({ id: message.id, ts: message.ts });
    },
  );

  // POST /api/chat/:roomId/history — a page of a room's recent messages, newest
  // first, for lazy-loading + scroll-up paging (CHAT-021). POST (not GET) so the
  // private-room `secret` rides the body, never the URL — same rule as sending.
  router.post(
    "/chat/:roomId/history",
    limit("chat_history"),
    async (req: Request, res: Response) => {
      const token = req.sessionToken;
      if (!token) {
        res.status(400).json({ error: "no_session" });
        return;
      }

      const apiKey = ablyOptions.apiKey ?? getAblyApiKey();
      if (!apiKey) {
        res.status(503).json({ error: "chat_unavailable" });
        return;
      }

      const roomId = req.params["roomId"];
      if (!isValidRoomId(roomId)) {
        res.status(400).json({ error: "INVALID_ROOM_ID" });
        return;
      }

      const body = req.body as HistoryRequestBody | undefined;

      // History is scoped by the same gate — a private room's transcript is not
      // readable without its code.
      const resolved = await resolveRoom(store, roomId, body?.secret, privateRoomKey(apiKey));
      if (!resolved.ok) {
        res.status(resolved.status).json({ error: resolved.error });
        return;
      }
      const { channelName } = resolved;

      const before = parseCursor(body?.before);
      const rawLimit = body?.limit;
      const limitReq =
        typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(Math.floor(rawLimit), MAX_HISTORY_LIMIT)
          : DEFAULT_HISTORY_LIMIT;

      try {
        // Fetch one extra to know whether an older page exists without a second query.
        const rows = await store.chat.page(channelName, {
          ...(before ? { before } : {}),
          limit: limitReq + 1,
        });
        const hasMore = rows.length > limitReq;
        const pageRows = hasMore ? rows.slice(0, limitReq) : rows;

        // The store returns newest-first (natural for "older than a cursor"); the
        // client renders oldest-at-top, so hand back ascending. The cursor is the
        // oldest message in this page — the `before` for the next scroll-up load.
        const ascending = [...pageRows].reverse();
        const oldest = pageRows[pageRows.length - 1];
        const cursor = oldest ? { ts: oldest.ts, id: oldest.id } : null;

        res.status(200).json({
          messages: ascending.map(toWireMessage),
          hasMore,
          cursor,
        });
      } catch (err) {
        // History is an enhancement — a store outage degrades to "no history"
        // (the client shows live-only), never an error over the game.
        console.error("[chat] history read failed", err);
        res.status(503).json({ error: "chat_unavailable" });
      }
    },
  );

  // GET /api/chat/rooms — the lobby list (CHAT-022). Public in both senses: no
  // session required, and it exposes nothing a room link wouldn't. Deliberately
  // read-only — rooms are administrator-owned and managed in the database, so
  // there is no create/update/delete counterpart (docs/CHAT_UI.md §6.3.1).
  router.get("/chat/rooms", limit("chat_rooms"), async (_req: Request, res: Response) => {
    const now = Date.now();
    if (cachedRooms && now - cachedRooms.at < ROOM_LIST_CACHE_MS) {
      res.status(200).json({ rooms: cachedRooms.payload });
      return;
    }

    let rooms;
    try {
      rooms = await store.chatRooms.list();
    } catch (err) {
      // The list degrades to absence, never an error over the game: the client
      // renders no rail and direct room links still work.
      console.error("[chat] room list failed", err);
      res.status(503).json({ error: "chat_unavailable" });
      return;
    }

    // Occupancy decorates the list; it never gates it. When it is unavailable
    // `active` is *omitted* rather than zeroed — an absent count is honest, a
    // zero would claim the room is empty.
    const apiKey = ablyOptions.apiKey ?? getAblyApiKey();
    const occupancy = apiKey ? await fetchChannelOccupancy(ablyOptions) : null;
    const hmacKey = apiKey ? privateRoomKey(apiKey) : null;

    const payload = rooms.map((room) => {
      const base = { id: room.id, label: room.label, visibility: room.visibility };
      if (!occupancy || !hmacKey) return base;
      // A private room is matched by its derived channel, not by scanning the
      // listing — the hash never has to be recognised, only recomputed.
      const channel = channelNameFor(
        room.id,
        room.visibility === "private" ? room.secret : null,
        hmacKey,
      );
      // Absent from enumeration means "no one is connected", which for a room
      // the registry vouches for is a genuine zero.
      return { ...base, active: occupancy.get(channel) ?? 0 };
    });

    cachedRooms = { at: now, payload };
    res.status(200).json({ rooms: payload });
  });

  return router;
}
