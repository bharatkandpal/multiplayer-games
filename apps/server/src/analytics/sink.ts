/**
 * The `EventSink` seam (MPG-097).
 *
 * Analytics is written against this interface, never against the store
 * directly, so that adding a hosted vendor later is a new implementation plus
 * one wiring line — not an edit to every call site. That was the explicit
 * decision: self-host now, keep the door open.
 *
 * The interface is deliberately thinner than `EventRepo`. A sink only has to
 * *accept* events; querying them back is a property of the self-hosted adapter
 * and is not something a fire-and-forget vendor client could honour anyway.
 */

import type { EventRepo, NewAnalyticsEvent } from "../store/ports.js";

export interface EventSink {
  /**
   * Accept a batch. MUST NOT throw and MUST NOT reject — see `createStoreSink`
   * for why this is a hard contract rather than a politeness.
   */
  record(events: readonly NewAnalyticsEvent[]): Promise<void>;
}

/**
 * The rule that governs every sink: **instrumentation may never break the thing
 * it measures.**
 *
 * A failed analytics write is a lost row, which is bad. A failed analytics
 * write that 500s a share mint is a lost *user*, which is worse — and it would
 * be a self-inflicted outage caused by the very code added to observe the
 * funnel. So the sink swallows, logs once, and returns. This is also the
 * server-side face of the platform's offline pillar: the product degrades to
 * *absence* of analytics, never to an error.
 */
export function createStoreSink(events: EventRepo): EventSink {
  return {
    async record(batch) {
      if (batch.length === 0) return;
      try {
        await events.record(batch);
      } catch (err) {
        // Deliberately `warn`, not `error`: this is degraded telemetry, not a
        // broken request, and paging on it would invert the priority above.
        console.warn(
          `[analytics] dropped ${batch.length} event(s):`,
          err instanceof Error ? err.message : err,
        );
      }
    },
  };
}

/** A sink that discards everything. For tests, and for running with analytics off. */
export function createNullSink(): EventSink {
  return {
    async record() {
      /* intentionally empty */
    },
  };
}

/**
 * Fire-and-forget a single server-side event.
 *
 * Call sites use this rather than `await`ing the sink so that a slow analytics
 * write cannot add latency to a user-facing response. The returned promise is
 * intentionally not awaited by callers; the sink's own contract guarantees it
 * never rejects, so this cannot produce an unhandled rejection.
 */
export function emit(sink: EventSink, event: NewAnalyticsEvent): void {
  void sink.record([event]);
}
