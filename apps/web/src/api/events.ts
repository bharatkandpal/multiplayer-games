/**
 * Client-side funnel instrumentation (MPG-097).
 *
 * The governing rule, inherited from the platform's offline pillar: **analytics
 * degrades to absence, never to an error.** Every failure mode here — server
 * down, request blocked by an extension, offline entirely — results in lost
 * rows and a game that plays exactly as well as it did before. Nothing in this
 * file is ever awaited by a caller, and nothing it does can reject into one.
 *
 * The client only reports what the server genuinely cannot see. `share_minted`
 * and `share_opened` are recorded server-side where they actually happen; the
 * browser's job is the one measurement only it holds — how long a cold visitor
 * took to make their first real input.
 */

import { apiFetch, getApiBaseUrl, getSessionToken } from "./session.js";

/** Mirrors the server's client-reportable allowlist in `analytics/events.ts`. */
export type ClientEventName = "first_input";

export type EventProps = Record<string, string | number | boolean>;

export interface QueuedEvent {
  readonly name: ClientEventName;
  readonly occurredAt: number;
  readonly gameId?: string;
  readonly shareLinkId?: string;
  readonly props?: EventProps;
}

/**
 * How long to hold events before sending. Long enough that a burst coalesces
 * into one request, short enough that a visitor who leaves quickly is still
 * counted — which matters here, because a fast bounce is exactly the signal
 * time-to-first-input exists to detect.
 */
const FLUSH_INTERVAL_MS = 5_000;

/** Hard cap on the queue. Matches the server's `MAX_BATCH`. */
const MAX_QUEUE = 50;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule(): void {
  if (timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Send whatever is queued. Safe to call at any time; a no-op when empty.
 *
 * The queue is drained *before* the request goes out, so a failed send drops
 * its batch rather than retrying. That is deliberate: a retry queue that
 * survives a server outage would grow without bound in memory and re-send
 * stale events on recovery, and this data is not worth either cost.
 */
export async function flush(): Promise<void> {
  if (queue.length === 0) return;

  const batch = queue;
  queue = [];

  try {
    await apiFetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: batch }),
      // Lets the request outlive the page when flushed during teardown.
      keepalive: true,
    });
  } catch {
    // Swallowed by design — see the file header.
  }
}

/**
 * Queue an event. Fire-and-forget: returns immediately, never throws.
 *
 * Over-cap events are dropped rather than evicting older ones. At 50 queued
 * events something is wrong with the caller, and the *first* events in a
 * session are the ones that carry the funnel signal.
 */
export function track(
  name: ClientEventName,
  detail: Omit<QueuedEvent, "name" | "occurredAt"> = {},
): void {
  if (queue.length >= MAX_QUEUE) return;

  queue.push({ name, occurredAt: Date.now(), ...detail });
  schedule();
}

/**
 * Flush on page teardown via `sendBeacon`.
 *
 * `pagehide` rather than `unload` because `unload` is unreliable on mobile
 * Safari and blocks the back/forward cache; `sendBeacon` rather than `fetch`
 * because a normal request is routinely cancelled when the document goes away.
 *
 * A beacon is a bare POST — it cannot carry the `x-session-token` header, so
 * the token rides in the body instead and the server falls back to it. That is
 * not a weaker check than the header: it is the same value, the same secret,
 * moved to the only place a beacon can put it.
 */
export function installFlushOnHide(): () => void {
  if (typeof window === "undefined") return () => {};

  const onHide = (): void => {
    if (queue.length === 0) return;

    const token = getSessionToken();
    const payload = JSON.stringify({
      events: queue,
      ...(token ? { sessionToken: token } : {}),
    });

    let delivered: boolean;
    try {
      // `type: text/plain` keeps the beacon a CORS-simple request, which is
      // what lets it survive teardown without a preflight the browser would
      // never get around to sending.
      delivered =
        navigator.sendBeacon?.(
          `${getApiBaseUrl()}/api/events`,
          new Blob([payload], { type: "text/plain" }),
        ) ?? false;
    } catch {
      delivered = false;
    }

    // The queue is drained only once the beacon has actually been accepted.
    // Draining first would strand the batch: `sendBeacon` returning false means
    // nothing was queued by the browser, and the `flush()` fallback would then
    // find an empty queue and send nothing at all.
    if (delivered) {
      queue = [];
    } else {
      void flush();
    }
  };

  window.addEventListener("pagehide", onHide);
  return () => window.removeEventListener("pagehide", onHide);
}

/** Test seam — drops anything queued without sending. */
export function __resetEventQueue(): void {
  queue = [];
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
}
