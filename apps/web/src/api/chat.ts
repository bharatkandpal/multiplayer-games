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
  /**
   * Client-only delivery marker for the sender's own optimistic bubble
   * (CHAT-018). `"pending"` while the POST is in flight; absent on every
   * message that arrived over the wire and on a confirmed send. Never sent to
   * or received from the server.
   */
  delivery?: "pending" | undefined;
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
export async function fetchChatToken(
  roomId: string,
  secret?: string,
): Promise<ChatTokenResponse | null> {
  try {
    const res = await apiFetch("/api/chat/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A private room carries a shared secret; the server folds it into the
      // channel name it scopes the token to (and returns as `channelName`).
      body: JSON.stringify(secret ? { roomId, secret } : { roomId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ChatTokenResponse;
  } catch {
    return null;
  }
}

/** A paging cursor into a room's history — everything strictly older than this. */
export interface ChatHistoryCursor {
  ts: number;
  id: string;
}

export interface ChatHistoryPage {
  /** Messages oldest-first, ready to render/prepend directly. */
  messages: ChatMessage[];
  /** Whether an older page exists beyond `cursor`. */
  hasMore: boolean;
  /** The `before` for the next scroll-up load; `null` when the page was empty. */
  cursor: ChatHistoryCursor | null;
}

/**
 * Loads a page of a room's recent history (CHAT-021) — the newest messages, or
 * (with `before`) the page just older than a cursor for scroll-up paging.
 * Resolves to `null` for ANY failure, exactly like {@link fetchChatToken}:
 * history is an enhancement, so a caller degrades to "no history, live only"
 * rather than surfacing an error. `secret` (a private room) routes the read to
 * the same secret-derived channel the subscription is on; it rides the body,
 * never the URL.
 */
export async function fetchChatHistory(
  roomId: string,
  opts: { before?: ChatHistoryCursor; limit?: number; secret?: string } = {},
): Promise<ChatHistoryPage | null> {
  try {
    const res = await apiFetch(`/api/chat/${encodeURIComponent(roomId)}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(opts.before ? { before: opts.before } : {}),
        ...(opts.limit === undefined ? {} : { limit: opts.limit }),
        ...(opts.secret ? { secret: opts.secret } : {}),
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ChatHistoryPage;
  } catch {
    return null;
  }
}

export type SendChatMessageResult =
  { ok: true; id: string; ts: number } | { ok: false; reason: "rate_limited" | "unavailable" };

/**
 * Posts a chat message. Never throws. The message itself is not returned
 * here — it arrives back over the Ably subscription once the server
 * broadcasts it, same as everyone else's messages.
 *
 * `id`, when given, is the client-minted message id the caller has already
 * rendered optimistically (CHAT-018): the server broadcasts under that same
 * id, so the echo reconciles the optimistic bubble instead of appending a
 * duplicate. Omit it and the server mints its own.
 */
export async function sendChatMessage(
  roomId: string,
  text: string,
  displayName: string,
  id?: string,
  secret?: string,
): Promise<SendChatMessageResult> {
  try {
    const res = await apiFetch(`/api/chat/${encodeURIComponent(roomId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `secret` (a private room) routes the publish to the same secret-derived
      // channel the subscription is on; omit it and it's the public channel.
      body: JSON.stringify({
        ...(id === undefined ? {} : { id }),
        ...(secret ? { secret } : {}),
        text,
        displayName,
      }),
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
