/**
 * Client-side chat API (CHAT-004..007) — the client half of the chat
 * endpoints (docs/API_SPEC.md, Bundle A).
 *
 * Chat is an enhancement layered on top of a game that already works without
 * it (CLAUDE.md "no feature may break offline play"): every call here
 * swallows its own failures and resolves to a definite "unavailable" shape
 * rather than throwing, so a caller never needs a try/catch of its own and a
 * downed chat service never surfaces as an error banner over the game.
 *
 * Messages themselves are never read from these HTTP responses — they only
 * arrive over the Ably subscription in `../hooks/useChatChannel.ts`, per the
 * wire contract. `POST /messages` only acknowledges that the send was
 * accepted (202) or explains why it wasn't (429 rate-limited, 503 down).
 */

import { apiFetch } from "./session.js";

/** One chat message, exactly as broadcast on the `chat:<roomId>` Ably channel. */
export interface ChatMessage {
  id: string;
  roomId: string;
  sender: {
    /** The sender's session token — the identity key used for local mute. */
    token: string;
    name: string;
  };
  text: string;
  /** Epoch milliseconds. Messages are ordered by this, not arrival order. */
  ts: number;
}

export interface ChatTokenResponse {
  /** Opaque Ably token material — handed straight to `authCallback`. */
  tokenRequest: unknown;
  channelName: string;
  clientId: string;
}

/**
 * Mints an Ably token for `roomId`. Resolves to `null` for ANY failure
 * (network error, timeout, non-2xx, a `503 chat_unavailable` from a chat
 * outage) — callers must treat `null` as "chat is unavailable right now" and
 * degrade to absence, never surface a raw error.
 */
export async function fetchChatToken(roomId: string): Promise<ChatTokenResponse | null> {
  try {
    const res = await apiFetch("/api/chat/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ChatTokenResponse;
  } catch {
    return null;
  }
}

export type SendChatMessageResult =
  { ok: true; id: string; ts: number } | { ok: false; reason: "rate_limited" | "unavailable" };

/**
 * Posts a chat message. Never throws. The message itself is not returned
 * here — it arrives back over the Ably subscription once the server
 * broadcasts it, same as everyone else's messages (so the sender's own
 * bubble reconciles the same way as any other, rather than trusting a
 * locally-composed echo).
 */
export async function sendChatMessage(
  roomId: string,
  text: string,
  displayName: string,
): Promise<SendChatMessageResult> {
  try {
    const res = await apiFetch(`/api/chat/${encodeURIComponent(roomId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, displayName }),
    });
    if (res.status === 202) {
      const body = (await res.json()) as { id: string; ts: number };
      return { ok: true, id: body.id, ts: body.ts };
    }
    if (res.status === 429) return { ok: false, reason: "rate_limited" };
    return { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
