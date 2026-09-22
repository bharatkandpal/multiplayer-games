/**
 * `useChatChannel` (CHAT-005) — mints an Ably token, subscribes to a room's
 * chat channel, and exposes a `send` that posts through the REST endpoint
 * (never a direct Ably publish — the server is the only writer, per
 * docs/API_SPEC.md).
 *
 * Chat is an enhancement (CLAUDE.md "no feature may break offline play"): any
 * auth/connection failure degrades to `status: "unavailable"` — no throw, no
 * retry loop, no spinner that outlives its request. `ChatScreen` reads
 * `status` to decide what to render; this hook never surfaces a raw error.
 */

import { useCallback, useEffect, useState } from "react";
import { Realtime } from "ably";
import type * as Ably from "ably";
import { fetchChatToken, sendChatMessage, type ChatMessage } from "../api/chat.js";
import { getStoredUsername } from "../api/username.js";
import { getSessionToken } from "../api/session.js";

export type ChatStatus = "connecting" | "live" | "unavailable";

export type SendChatResult = { ok: true } | { ok: false; reason: "rate_limited" | "unavailable" };

export interface UseChatChannelResult {
  messages: ChatMessage[];
  status: ChatStatus;
  /** Posts a message via the REST endpoint. Resolves once accepted or rejected — the message itself arrives later, over the subscription. */
  send: (text: string) => Promise<SendChatResult>;
  /** The raw Ably connection state, for diagnostics; `"unknown"` before a client exists. */
  connectionState: Ably.ConnectionState | "unknown";
}

const TERMINAL_STATES = new Set<Ably.ConnectionState>(["failed", "suspended", "closed"]);

/**
 * Subscribes to `chat:<roomId>` for the lifetime of the hook, tearing the
 * Ably connection down and rebuilding it whenever `roomId` changes or the
 * component unmounts.
 */
export function useChatChannel(roomId: string): UseChatChannelResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("connecting");
  const [connectionState, setConnectionState] = useState<Ably.ConnectionState | "unknown">(
    "unknown",
  );

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setStatus("connecting");
    setConnectionState("unknown");

    let client: Ably.Realtime;

    // No token means chat is down (a 503, a network failure, …). We degrade to
    // absence *immediately* rather than waiting on Ably's connection state
    // machine: an auth-callback error sends Ably into disconnected→retry, which
    // never reaches a terminal state, so `status` would sit at "connecting"
    // forever (composer disabled, but no "unavailable" notice) while Ably
    // quietly re-hits the token endpoint on a loop — exactly the retry loop the
    // offline pillar forbids. Flip to "unavailable" and close the connection so
    // there is no background retry. The "connecting" guard below then keeps a
    // late state-change from resurrecting it.
    const degrade = (): void => {
      if (cancelled) return;
      setStatus("unavailable");
      try {
        client.close();
      } catch {
        // Closing a client that never finished connecting can throw; the UI is
        // already degraded, which is all that matters.
      }
    };

    try {
      client = new Realtime({
        autoConnect: true,
        authCallback: (_params, callback) => {
          fetchChatToken(roomId)
            .then((token) => {
              if (cancelled) return;
              if (!token) {
                callback("chat_unavailable", null);
                degrade();
                return;
              }
              callback(null, token.tokenRequest as Ably.TokenDetails);
            })
            .catch(() => {
              if (cancelled) return;
              callback("chat_unavailable", null);
              degrade();
            });
        },
      });
    } catch {
      // Ably threw synchronously constructing the client (malformed options,
      // an environment without the APIs it needs, …) — degrade, don't throw.
      setStatus("unavailable");
      return undefined;
    }

    const channel = client.channels.get(`chat:${roomId}`);

    const handleConnectionChange = (change: Ably.ConnectionStateChange): void => {
      if (cancelled) return;
      setConnectionState(change.current);
      if (TERMINAL_STATES.has(change.current)) {
        setStatus("unavailable");
      } else if (change.current === "connected") {
        setStatus("live");
      } else {
        // "connecting" / "disconnected" / "initialized" — still trying, unless
        // we've already given up (don't resurrect an unavailable state from a
        // transient reconnect attempt Ably itself controls the cadence of).
        setStatus((prev) => (prev === "unavailable" ? prev : "connecting"));
      }
    };
    client.connection.on(handleConnectionChange);

    const handleMessage = (msg: Ably.InboundMessage): void => {
      if (cancelled) return;
      const data = msg.data as Partial<ChatMessage> | undefined;
      if (!data || typeof data.id !== "string") return;
      const incoming = data as ChatMessage;
      setMessages((prev) => {
        // Reconcile by id: this broadcast either confirms the sender's own
        // optimistic bubble (CHAT-018) or is a duplicate re-delivery — in both
        // cases replace in place with this authoritative server copy (masked
        // text, server ts, no `delivery` marker). Otherwise it's someone
        // else's message: append it.
        const idx = prev.findIndex((m) => m.id === incoming.id);
        const next =
          idx >= 0 ? prev.map((m, i) => (i === idx ? incoming : m)) : [...prev, incoming];
        next.sort((a, b) => a.ts - b.ts);
        return next;
      });
    };
    channel.subscribe("message", handleMessage).catch(() => {
      // A subscribe failure (e.g. the channel itself is denied) also degrades
      // rather than throwing — the connection-state handler above will also
      // move to "unavailable" as the underlying connection settles.
      if (!cancelled) setStatus("unavailable");
    });

    return () => {
      cancelled = true;
      client.connection.off(handleConnectionChange);
      channel.unsubscribe("message", handleMessage);
      client.close();
    };
  }, [roomId]);

  const send = useCallback(
    async (text: string): Promise<SendChatResult> => {
      const displayName = getStoredUsername() ?? "Player";
      // Mint the id up front so the broadcast echo reconciles this exact
      // bubble, and render it immediately as "pending" (CHAT-018): the sender
      // sees their message the instant they hit send, not after the full
      // client→server→Ably→subscription round-trip.
      const id = crypto.randomUUID();
      const optimistic: ChatMessage = {
        id,
        roomId,
        // Session token so the bubble reads as our own and local mute stays
        // consistent; the broadcast echo carries the same, server-derived one.
        sender: { token: getSessionToken() ?? "", name: displayName },
        text,
        ts: Date.now(),
        delivery: "pending",
      };
      setMessages((prev) => {
        const next = [...prev, optimistic];
        next.sort((a, b) => a.ts - b.ts);
        return next;
      });

      const result = await sendChatMessage(roomId, text, displayName, id);
      if (result.ok) {
        // Clear the pending marker so a dropped broadcast echo can't strand the
        // bubble as "sending…" forever; if the echo does arrive it replaces the
        // whole entry anyway.
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, delivery: undefined } : m)));
        return { ok: true };
      }
      // The send never reached the server — pull the optimistic bubble back out
      // (ChatScreen restores the draft, so nothing typed is lost).
      setMessages((prev) => prev.filter((m) => m.id !== id));
      return { ok: false, reason: result.reason };
    },
    [roomId],
  );

  return { messages, status, send, connectionState };
}
