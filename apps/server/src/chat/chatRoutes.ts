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

import { Router } from "express";
import type { Request, Response } from "express";

import { noopLimit, type RateLimitFor } from "../middleware/rateLimit.js";
import type { ChatCursor, ChatStoredMessage, Store } from "../store/ports.js";
import {
  requestAblyToken,
  publishAblyMessage,
  getAblyApiKey,
  type AblyClientOptions,
} from "./ably.js";
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
): Router {
  const router = Router();

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

    // A private room folds a shared secret into the channel name; a public room
    // (no secret) keeps the plain `chat:<roomId>` channel.
    const secret = normalizeRoomSecret(body?.secret);
    if (!secret.ok) {
      res.status(400).json({ error: "INVALID_SECRET" });
      return;
    }

    const channelName = channelNameFor(roomId, secret.secret, privateRoomKey(apiKey));

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

      // Publish to the same secret-derived channel the sender's token was
      // scoped to; a wrong/missing secret just publishes to a different channel.
      const secret = normalizeRoomSecret(body?.secret);
      if (!secret.ok) {
        res.status(400).json({ error: "INVALID_SECRET" });
        return;
      }

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
        roomId,
        // Sender identity comes from the session, never the request body — a
        // caller cannot claim to be someone else's session token.
        sender: { token: senderToken, name: displayName },
        text: maskProfanity(text),
        ts: Date.now(),
      };

      const channelName = channelNameFor(roomId, secret.secret, privateRoomKey(apiKey));

      try {
        await publishAblyMessage(channelName, message, ablyOptions);
      } catch (err) {
        console.error("[chat] publish failed", err);
        res.status(503).json({ error: "chat_unavailable" });
        return;
      }

      // Persist for history (CHAT-021) — strictly best-effort and off the
      // critical path: the message is already delivered live, so a store outage
      // must degrade history to absence, never turn a delivered message into a
      // 503. Keyed by the derived channel (a private room groups by its opaque
      // hash); the secret is never stored.
      try {
        await store.chat.append({
          id: message.id,
          channel: channelName,
          roomId,
          senderToken: message.sender.token,
          senderName: message.sender.name,
          text: message.text,
          ts: message.ts,
        });
      } catch (err) {
        console.error("[chat] history persist failed (message still delivered)", err);
      }

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

      const secret = normalizeRoomSecret(body?.secret);
      if (!secret.ok) {
        res.status(400).json({ error: "INVALID_SECRET" });
        return;
      }

      const before = parseCursor(body?.before);
      const rawLimit = body?.limit;
      const limitReq =
        typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(Math.floor(rawLimit), MAX_HISTORY_LIMIT)
          : DEFAULT_HISTORY_LIMIT;

      const channelName = channelNameFor(roomId, secret.secret, privateRoomKey(apiKey));

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

  return router;
}
