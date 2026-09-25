/**
 * Client-side game token API — the client half of `POST /api/game/token`
 * (docs/API_SPEC.md), which mints an Ably token for peer-to-peer online play.
 *
 * Unlike chat, there is no server room registry to consult: every online room
 * is a private, invite-link room, so `secret` is REQUIRED here (chat's is
 * optional). Mirrors `./chat.ts`'s shape and its offline-pillar posture
 * exactly (CLAUDE.md "no feature may break offline play"): every call here
 * resolves to a definite result rather than throwing, so online play degrades
 * to "unavailable" — never an error banner over a game that already works
 * fine locally against a bot.
 */

import { apiFetch } from "./session.js";

export interface GameTokenResponse {
  /** Opaque Ably token material — handed straight to `authCallback`. */
  tokenRequest: unknown;
  channelName: string;
  clientId: string;
}

/**
 * Why a token request failed. There is no "unknown_room" case here (unlike
 * chat's): a game room has no DB row to be missing — a bad/missing secret and
 * a genuinely down service are the only two ways this can fail.
 */
export type GameTokenResult =
  { ok: true; token: GameTokenResponse } | { ok: false; reason: "bad_secret" | "unavailable" };

/**
 * Mints an Ably token for `(roomId, secret)`. Resolves to `null` for ANY
 * failure — callers must treat `null` as "online play is unavailable right
 * now" and degrade to absence (no online affordance), never a raw error.
 */
export async function fetchGameToken(
  roomId: string,
  secret: string,
  clientId?: string,
): Promise<GameTokenResponse | null> {
  const result = await requestGameToken(roomId, secret, clientId);
  return result.ok ? result.token : null;
}

/** The same request as {@link fetchGameToken}, keeping the reason. Never throws. */
export async function requestGameToken(
  roomId: string,
  secret: string,
  clientId?: string,
): Promise<GameTokenResult> {
  try {
    const res = await apiFetch("/api/game/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, secret, ...(clientId ? { clientId } : {}) }),
    });
    // The route reports both a malformed room id and a malformed/missing
    // secret as `400`; either way this session's link/secret pairing is bad,
    // which the caller (a secret-scoped room, unlike chat's optional one)
    // treats identically to a wrong secret.
    if (res.status === 400) return { ok: false, reason: "bad_secret" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    return { ok: true, token: (await res.json()) as GameTokenResponse };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
