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

import { useCallback, useEffect, useRef, useState } from "react";
import { Realtime } from "ably";
import type * as Ably from "ably";
import {
  fetchChatHistory,
  fetchChatToken,
  sendChatMessage,
  type ChatHistoryCursor,
  type ChatMessage,
  type ChatTokenResponse,
} from "../api/chat.js";
import { getStoredUsername } from "../api/username.js";
import { getSessionToken } from "../api/session.js";

export type ChatStatus = "connecting" | "live" | "unavailable";

export type SendChatResult = { ok: true } | { ok: false; reason: "rate_limited" | "unavailable" };

/** How many messages a first load / each scroll-up page fetches (CHAT-021). */
const HISTORY_PAGE_SIZE = 10;

export interface UseChatChannelResult {
  messages: ChatMessage[];
  status: ChatStatus;
  /** Posts a message via the REST endpoint. Resolves once accepted or rejected — the message itself arrives later, over the subscription. */
  send: (text: string) => Promise<SendChatResult>;
  /** Whether an older page of history exists to load (CHAT-021). */
  hasMoreHistory: boolean;
  /** True while an older page is in flight — the UI shows a subtle affordance and shouldn't re-trigger. */
  loadingOlder: boolean;
  /** Loads the next older page and prepends it. No-op when nothing older exists or a load is already running. */
  loadOlder: () => Promise<void>;
  /** The raw Ably connection state, for diagnostics; `"unknown"` before a client exists. */
  connectionState: Ably.ConnectionState | "unknown";
}

const TERMINAL_STATES = new Set<Ably.ConnectionState>(["failed", "suspended", "closed"]);

/**
 * Merge messages by `id` into an existing, ts-ordered list. A message with a
 * known id replaces the existing copy in place (the authoritative server echo
 * supersedes the sender's optimistic bubble, CHAT-018, and a re-delivery
 * supersedes itself); an unknown id is added. The result is re-sorted by `ts`,
 * so history seeded at the top, live appends at the bottom, and older pages
 * prepended on scroll all land in one correctly-ordered list.
 */
function mergeMessages(prev: ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const msg of incoming) byId.set(msg.id, msg);
  const next = [...byId.values()];
  next.sort((a, b) => a.ts - b.ts);
  return next;
}

/**
 * Subscribes to a room's chat channel for the lifetime of the hook, tearing the
 * Ably connection down and rebuilding it whenever `roomId` (or `secret`)
 * changes or the component unmounts.
 *
 * `secret`, when given, joins the *private* variant of the room: the server
 * derives an opaque channel from `(roomId, secret)` and scopes the token to it,
 * so only callers who supply the same secret share a channel. The client never
 * derives that channel itself — it subscribes to whatever `channelName` the
 * token endpoint returns (public `chat:<roomId>` or the private hash).
 *
 * `enabled` (default `true`) gates the connection: a private room whose secret
 * hasn't been entered yet passes `false` so the hook stays idle — it must not
 * quietly connect to the *public* `chat:<roomId>` channel behind the lock
 * screen. Flip it to `true` (with the secret) once the room is unlocked.
 */
export function useChatChannel(
  roomId: string,
  secret?: string,
  enabled = true,
): UseChatChannelResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("connecting");
  const [connectionState, setConnectionState] = useState<Ably.ConnectionState | "unknown">(
    "unknown",
  );
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // History paging state that must survive renders and be reset on room/secret
  // change: the cursor for the next older page, a re-entrancy guard, and a
  // generation counter so an in-flight `loadOlder` from a previous room can't
  // apply its page to a new one.
  const oldestCursorRef = useRef<ChatHistoryCursor | null>(null);
  const loadingOlderRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const generation = ++generationRef.current;
    setMessages([]);
    setStatus("connecting");
    setConnectionState("unknown");
    setHasMoreHistory(false);
    setLoadingOlder(false);
    oldestCursorRef.current = null;
    loadingOlderRef.current = false;

    // A locked private room stays idle — no token, no connection — until it is
    // unlocked (the UI shows a secret gate, never this hook's status).
    if (!enabled) return undefined;

    // Seed the newest page of history so the room opens with recent context
    // instead of blank (CHAT-021). Best-effort and independent of the live
    // connection: a null page (history down, or simply nothing stored yet)
    // just leaves the room to fill from live messages — never an error, never a
    // block (offline pillar). Live messages that race this seed reconcile by id
    // through `mergeMessages`.
    void fetchChatHistory(roomId, {
      limit: HISTORY_PAGE_SIZE,
      ...(secret ? { secret } : {}),
    }).then((page) => {
      if (cancelled || generation !== generationRef.current || !page) return;
      setMessages((prev) => mergeMessages(prev, page.messages));
      oldestCursorRef.current = page.cursor;
      setHasMoreHistory(page.hasMore);
    });

    let client: Ably.Realtime | undefined;
    let channel: Ably.RealtimeChannel | undefined;

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
        client?.close();
      } catch {
        // Closing a client that never finished connecting can throw; the UI is
        // already degraded, which is all that matters.
      }
    };

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

    const handleMessage = (msg: Ably.InboundMessage): void => {
      if (cancelled) return;
      const data = msg.data as Partial<ChatMessage> | undefined;
      if (!data || typeof data.id !== "string") return;
      const incoming = data as ChatMessage;
      // Reconcile by id: this broadcast either confirms the sender's own
      // optimistic bubble (CHAT-018), duplicates a re-delivery, or is someone
      // else's new message — `mergeMessages` handles all three (replace in
      // place with the authoritative server copy, or append), then re-sorts.
      setMessages((prev) => mergeMessages(prev, [incoming]));
    };

    // Learn the channel name from the server before connecting — a private
    // room's channel is a secret-derived hash the client can't compute itself.
    // `primed` feeds this first token to Ably's initial auth so we don't mint a
    // second one on connect; later renewals re-fetch (same room+secret → same
    // channel, fresh token).
    let primed: ChatTokenResponse | null = null;

    fetchChatToken(roomId, secret)
      .then((initial) => {
        if (cancelled) return;
        if (!initial) {
          degrade();
          return;
        }
        primed = initial;

        try {
          client = new Realtime({
            autoConnect: true,
            authCallback: (_params, callback) => {
              const first = primed;
              primed = null;
              const source = first ? Promise.resolve(first) : fetchChatToken(roomId, secret);
              source
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
          // Ably threw synchronously constructing the client (malformed
          // options, an environment without the APIs it needs, …) — degrade.
          setStatus("unavailable");
          return;
        }

        channel = client.channels.get(initial.channelName);
        client.connection.on(handleConnectionChange);
        channel.subscribe("message", handleMessage).catch(() => {
          // A subscribe failure (e.g. the channel itself is denied) also
          // degrades rather than throwing — the connection-state handler will
          // also move to "unavailable" as the underlying connection settles.
          if (!cancelled) setStatus("unavailable");
        });
      })
      .catch(() => {
        degrade();
      });

    return () => {
      cancelled = true;
      if (client) client.connection.off(handleConnectionChange);
      if (channel) channel.unsubscribe("message", handleMessage);
      if (client) client.close();
    };
  }, [roomId, secret, enabled]);

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

      const result = await sendChatMessage(roomId, text, displayName, id, secret);
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
    [roomId, secret],
  );

  const loadOlder = useCallback(async (): Promise<void> => {
    // Nothing older to load, or a load is already running — no-op (the UI
    // guards too, but scroll handlers fire fast, so guard here as well).
    const cursor = oldestCursorRef.current;
    if (!cursor || loadingOlderRef.current) return;

    const generation = generationRef.current;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await fetchChatHistory(roomId, {
        before: cursor,
        limit: HISTORY_PAGE_SIZE,
        ...(secret ? { secret } : {}),
      });
      // Bail if the room/secret changed while we were fetching, so a stale page
      // can't land in the wrong room. A null page (history down) degrades to
      // absence: we simply stop offering "load older" for now.
      if (generation !== generationRef.current) return;
      if (!page) {
        setHasMoreHistory(false);
        return;
      }
      setMessages((prev) => mergeMessages(prev, page.messages));
      // Only advance the cursor when the page actually had messages; an empty
      // page leaves the cursor put and just closes off further loading.
      if (page.cursor) oldestCursorRef.current = page.cursor;
      setHasMoreHistory(page.hasMore);
    } finally {
      loadingOlderRef.current = false;
      if (generation === generationRef.current) setLoadingOlder(false);
    }
  }, [roomId, secret]);

  return { messages, status, send, hasMoreHistory, loadingOlder, loadOlder, connectionState };
}
