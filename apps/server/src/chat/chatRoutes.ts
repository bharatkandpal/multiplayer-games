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
import {
  requestAblyToken,
  publishAblyMessage,
  getAblyApiKey,
  type AblyClientOptions,
} from "./ably.js";
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

function channelNameFor(roomId: string): string {
  return `chat:${roomId}`;
}

function isValidRoomId(value: unknown): value is string {
  return typeof value === "string" && ROOM_ID_RE.test(value);
}

interface TokenRequestBody {
  readonly roomId?: unknown;
}

interface SendMessageBody {
  readonly id?: unknown;
  readonly text?: unknown;
  readonly displayName?: unknown;
}

/**
 * `ablyOptions` exists purely so tests can inject a fake `fetch` and/or a
 * fake API key without touching `process.env` — production call sites
 * (`apiApp.ts`) never pass it, so the real endpoints/env are used.
 */
export function createChatRouter(
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

    if (!getAblyApiKey() && !ablyOptions.apiKey) {
      res.status(503).json({ error: "chat_unavailable" });
      return;
    }

    const body = req.body as TokenRequestBody | undefined;
    const roomId = body?.roomId;
    if (!isValidRoomId(roomId)) {
      res.status(400).json({ error: "INVALID_ROOM_ID" });
      return;
    }

    const channelName = channelNameFor(roomId);

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

      if (!getAblyApiKey() && !ablyOptions.apiKey) {
        res.status(503).json({ error: "chat_unavailable" });
        return;
      }

      const roomId = req.params["roomId"];
      if (!isValidRoomId(roomId)) {
        res.status(400).json({ error: "INVALID_ROOM_ID" });
        return;
      }

      const body = req.body as SendMessageBody | undefined;
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

      try {
        await publishAblyMessage(channelNameFor(roomId), message, ablyOptions);
      } catch (err) {
        console.error("[chat] publish failed", err);
        res.status(503).json({ error: "chat_unavailable" });
        return;
      }

      res.status(202).json({ id: message.id, ts: message.ts });
    },
  );

  return router;
}
