/**
 * Dependency-free Ably REST client (CHAT-002/003).
 *
 * The server is the ONLY Ably publisher (ADR 0005) — chat is ephemeral
 * pub/sub with no durable transcript, so this file's entire job is minting
 * subscribe-only tokens and publishing messages the server already
 * authored. No SDK: two REST calls, done with the global `fetch` so this
 * package needs no new dependency.
 *
 * Both entry points return/throw in a way callers can turn into the
 * documented graceful-degradation shape: `getAblyApiKey()` returning
 * `undefined` (env var absent) is the ONE signal that means "chat is
 * disabled here" — everything else (a thrown error) means "chat is
 * configured but Ably is unhappy right now," which the route layer also
 * maps to a 503. Chat is an enhancement (CLAUDE.md); it must never surface
 * as a hard failure to a player just trying to keep playing.
 */

const ABLY_REST_BASE = "https://rest.ably.io";

/** One hour — long enough to cover a room's lifetime without a lot of re-minting. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

export interface AblyClientOptions {
  /** Full `ABLY_API_KEY` value (`"<keyName>:<secret>"`). Defaults to `process.env.ABLY_API_KEY`. */
  apiKey?: string | undefined;
  /** Injectable `fetch` — tests must never make a real network call. */
  fetchImpl?: typeof fetch;
}

/** `undefined` when unset — the one signal the route layer treats as "chat disabled here". */
export function getAblyApiKey(): string | undefined {
  const raw = process.env["ABLY_API_KEY"];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/** The part of `ABLY_API_KEY` before the colon — what Ably calls the key name. */
export function parseAblyKeyName(apiKey: string): string {
  const idx = apiKey.indexOf(":");
  return idx === -1 ? apiKey : apiKey.slice(0, idx);
}

function basicAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(apiKey, "utf8").toString("base64")}`;
}

/**
 * Mint a token scoped to `capability` (a channel-name → operations map),
 * e.g. `{ "chat:abc123": ["subscribe"] }`. Returns the raw Ably
 * TokenDetails JSON, handed straight to the client as-is — the client's
 * `ably-js` SDK knows how to consume it.
 *
 * Throws on a non-2xx Ably response or a network failure; never called when
 * `getAblyApiKey()` is `undefined` (callers check that first).
 */
export async function requestAblyToken(
  capability: Record<string, string[]>,
  clientId: string,
  opts: AblyClientOptions = {},
): Promise<unknown> {
  const apiKey = opts.apiKey ?? getAblyApiKey();
  if (!apiKey) {
    throw new Error("requestAblyToken called without an ABLY_API_KEY configured");
  }
  const keyName = parseAblyKeyName(apiKey);
  const fetchImpl = opts.fetchImpl ?? fetch;

  const response = await fetchImpl(
    `${ABLY_REST_BASE}/keys/${encodeURIComponent(keyName)}/requestToken`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keyName,
        capability: JSON.stringify(capability),
        clientId,
        ttl: TOKEN_TTL_MS,
        timestamp: Date.now(),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Ably requestToken failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Publish `data` as a `message` event on `channelName`. The server is the
 * only writer of this channel (ADR 0005) — clients only ever subscribe.
 *
 * Throws on a non-2xx Ably response or a network failure; never called when
 * `getAblyApiKey()` is `undefined` (callers check that first).
 */
export async function publishAblyMessage(
  channelName: string,
  data: unknown,
  opts: AblyClientOptions = {},
): Promise<void> {
  const apiKey = opts.apiKey ?? getAblyApiKey();
  if (!apiKey) {
    throw new Error("publishAblyMessage called without an ABLY_API_KEY configured");
  }
  const fetchImpl = opts.fetchImpl ?? fetch;

  const response = await fetchImpl(
    `${ABLY_REST_BASE}/channels/${encodeURIComponent(channelName)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "message", data }),
    },
  );

  if (!response.ok) {
    throw new Error(`Ably publish failed: ${response.status}`);
  }
}

/** One channel's live subscriber count, keyed by channel name. */
export type ChannelOccupancy = ReadonlyMap<string, number>;

/**
 * Current subscriber counts for every *active* channel, via Ably's channel
 * enumeration (CHAT-022). Verified against our account: enumeration is
 * permitted and `metrics.subscribers` tracks real subscribers exactly (see
 * docs/CHAT_UI.md §7).
 *
 * Two things callers must know:
 *
 *  - **Only active channels appear.** A room nobody is sitting in is simply
 *    absent from the map — that is "zero", not "unknown", for a room the
 *    registry vouches for.
 *  - **Private channels appear too**, as their opaque `chat:p-<hmac>` names.
 *    The map is keyed by channel, so a caller resolves a private room by
 *    deriving its channel — nothing here leaks which hashes exist to a client.
 *
 * Returns `null` on any failure. Occupancy is decoration on a list that must
 * render without it (offline pillar), so this never throws.
 */
export async function fetchChannelOccupancy(
  opts: AblyClientOptions = {},
): Promise<ChannelOccupancy | null> {
  const apiKey = opts.apiKey ?? getAblyApiKey();
  if (!apiKey) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(`${ABLY_REST_BASE}/channels?by=id,occupancy&limit=100`, {
      headers: { Authorization: basicAuthHeader(apiKey) },
    });
    if (!response.ok) return null;

    const body: unknown = await response.json();
    if (!Array.isArray(body)) return null;

    const counts = new Map<string, number>();
    for (const entry of body) {
      const row = entry as {
        channelId?: unknown;
        status?: { occupancy?: { metrics?: { subscribers?: unknown } } };
      };
      const id = row.channelId;
      const subscribers = row.status?.occupancy?.metrics?.subscribers;
      if (typeof id === "string" && typeof subscribers === "number") {
        counts.set(id, subscribers);
      }
    }
    return counts;
  } catch {
    // Network failure, malformed JSON, a key without `channel-metadata` — all
    // the same to the caller: counts are unavailable, the list still renders.
    return null;
  }
}
