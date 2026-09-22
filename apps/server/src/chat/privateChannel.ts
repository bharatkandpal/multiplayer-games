/**
 * Private-room channel derivation (CHAT-020).
 *
 * Chat is stateless and ephemeral (ADR 0005 / chatRoutes.ts): there is no
 * durable store, so a private room cannot be a row in a table with a password
 * column the server checks. Instead, privacy is a *capability*: the actual Ably
 * channel a private room lives on is an opaque HMAC of `(roomId, secret)`, and
 * the token endpoint only ever grants a token scoped to the channel it derives
 * from the secret the caller supplied. Supply the right secret and you get a
 * token for the same channel everyone else in the room got; supply the wrong
 * one (or none) and you get a token for a *different* channel and simply never
 * see the private conversation. No membership registry, no secret store,
 * nothing to be "down" — which keeps private rooms inside the offline pillar
 * (CLAUDE.md): they add nothing that gameplay, or even public chat, depends on.
 *
 * The HMAC is keyed by a server-only secret so the channel name reveals nothing
 * about the room secret even to someone who somehow observed it — but note the
 * security boundary is the *token scoping*, not the name's secrecy: a client
 * can never subscribe to a channel its token wasn't scoped to, however it
 * learned the name.
 */

import { createHmac } from "node:crypto";

/** A room secret is just a string the humans agree on — keep it short and simple. */
export const MAX_ROOM_SECRET_LENGTH = 128;

/** How many hex chars of the HMAC name a private channel — 128 bits, collision-free in practice. */
const PRIVATE_CHANNEL_HASH_LENGTH = 32;

export type NormalizedSecret =
  // No secret was supplied — this is a public room.
  | { readonly ok: true; readonly secret: null }
  // A usable secret was supplied — this is a private room.
  | { readonly ok: true; readonly secret: string }
  // A secret field was present but malformed (wrong type / too long).
  | { readonly ok: false };

/**
 * Turns an untrusted request-body `secret` into a decision: public (absent or
 * blank), private (a trimmed non-empty string within the cap), or invalid.
 *
 * Trimming is authoritative and happens here so the token and message endpoints
 * derive the *same* channel from `" royal "` and `"royal"` — otherwise a sender
 * and a subscriber who typed the same secret with different whitespace would
 * land on different channels and never see each other.
 */
export function normalizeRoomSecret(raw: unknown): NormalizedSecret {
  if (raw === undefined || raw === null) return { ok: true, secret: null };
  if (typeof raw !== "string") return { ok: false };
  if (raw.length > MAX_ROOM_SECRET_LENGTH) return { ok: false };
  const trimmed = raw.trim();
  // A blank secret is treated as "no secret" (public), not an error — an empty
  // field should never wedge a caller out of chat entirely.
  if (trimmed.length === 0) return { ok: true, secret: null };
  return { ok: true, secret: trimmed };
}

/**
 * The Ably channel a room lives on. Public rooms use `chat:<roomId>` (unchanged
 * from CHAT-002, so existing links keep working); private rooms use an opaque
 * `chat:p-<hmac>` derived from the secret. `roomId` is folded into the HMAC so
 * the same secret in two different rooms yields two different channels.
 */
export function channelNameFor(roomId: string, secret: string | null, hmacKey: string): string {
  if (secret === null) return `chat:${roomId}`;
  const digest = createHmac("sha256", hmacKey)
    .update(`${roomId}\n${secret}`)
    .digest("hex")
    .slice(0, PRIVATE_CHANNEL_HASH_LENGTH);
  return `chat:p-${digest}`;
}
