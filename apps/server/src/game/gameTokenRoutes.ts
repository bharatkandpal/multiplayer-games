/**
 * Ably token minting for peer-to-peer online play.
 *
 * Unlike chat (ADR 0005 — server is the only publisher), online play has no
 * server in the loop at all: two browsers exchange moves directly over an
 * Ably channel, each validating the other's moves against the shared, pure
 * `GameModule` (packages/engine) before applying them — the same trust model
 * local hot-seat and bot play already use. There is no room registry, no
 * Neon row, nothing to persist: the channel is an opaque HMAC of
 * `(roomId, secret)` exactly like a private chat room
 * (`../chat/privateChannel.ts`), and a room only "exists" for as long as two
 * browsers hold the link.
 *
 * The one deliberate divergence from chat's token route: the capability
 * granted here includes `publish`, not just `subscribe`, because both peers
 * need to write moves directly — there's no server endpoint doing it for them.
 *
 * Offline pillar (CLAUDE.md): online play is a pure enhancement over a game
 * that already works locally (bots run entirely client-side). If
 * `ABLY_API_KEY` is unset, or Ably itself errors, this degrades to
 * `503 { error: "game_unavailable" }` — never a 500.
 */

import { Router } from "express";
import type { Request, Response } from "express";

import { noopLimit, type RateLimitFor } from "../middleware/rateLimit.js";
import { getAblyApiKey, requestAblyToken, type AblyClientOptions } from "../chat/ably.js";
import { channelNameFor, normalizeRoomSecret } from "../chat/privateChannel.js";

/** Matches the "safe slug" shape a client-generated room id already is. */
const ROOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function isValidRoomId(value: unknown): value is string {
  return typeof value === "string" && ROOM_ID_RE.test(value);
}

function isValidClientId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/**
 * The HMAC key that derives a game channel from (roomId, secret). A dedicated
 * `GAME_PRIVATE_ROOM_KEY` lets this be rotated independently of chat's; unset
 * falls back to the Ably API key itself, same as chat's `privateRoomKey`.
 */
function gamePrivateRoomKey(resolvedApiKey: string): string {
  const dedicated = process.env["GAME_PRIVATE_ROOM_KEY"];
  return typeof dedicated === "string" && dedicated.length > 0 ? dedicated : resolvedApiKey;
}

interface GameTokenRequestBody {
  readonly roomId?: unknown;
  readonly secret?: unknown;
  readonly clientId?: unknown;
}

export function createGameRouter(
  limit: RateLimitFor = noopLimit,
  ablyOptions: AblyClientOptions = {},
): Router {
  const router = Router();

  // POST /api/game/token — mint a subscribe+publish token scoped to one
  // secret-derived channel. Every online room is a private invite-link room
  // (no public game lobby), so a secret is required.
  router.post("/game/token", limit("game_token"), async (req: Request, res: Response) => {
    const apiKey = ablyOptions.apiKey ?? getAblyApiKey();
    if (!apiKey) {
      res.status(503).json({ error: "game_unavailable" });
      return;
    }

    const body = req.body as GameTokenRequestBody | undefined;
    const roomId = body?.roomId;
    if (!isValidRoomId(roomId)) {
      res.status(400).json({ error: "INVALID_ROOM_ID" });
      return;
    }

    const normalized = normalizeRoomSecret(body?.secret);
    if (!normalized.ok || normalized.secret === null) {
      res.status(400).json({ error: "INVALID_SECRET" });
      return;
    }

    const clientId = isValidClientId(body?.clientId) ? body.clientId : roomId;

    const channelName = channelNameFor(
      "game",
      roomId,
      normalized.secret,
      gamePrivateRoomKey(apiKey),
    );

    try {
      const tokenRequest = await requestAblyToken(
        { [channelName]: ["subscribe", "publish"] },
        clientId,
        ablyOptions,
      );
      res.status(200).json({ tokenRequest, channelName, clientId });
    } catch (err) {
      console.error("[game] token mint failed", err);
      res.status(503).json({ error: "game_unavailable" });
    }
  });

  return router;
}
