/**
 * `POST /api/events` — client-reported funnel events (MPG-097).
 *
 * Two rules shape this endpoint:
 *
 *  1. **It never fails the caller for bad data.** The client fires these in the
 *     background, often during unload; there is no UI to show an error to and
 *     no retry that would help. Unknown or malformed events are dropped and
 *     counted in the response, and the call still returns 202. The one thing
 *     that *does* 4xx is a structurally invalid body, because that is a bug in
 *     the caller rather than a stale event name.
 *  2. **The client cannot report server-side truth.** Only events on the
 *     client-reportable allowlist are accepted; the rest are dropped even when
 *     well-formed. See `events.ts` for why.
 *
 * Note the absence of rate limiting: this is a live anonymous write endpoint
 * and MPG-021 is the task that fixes that class of exposure across all of them.
 * `MAX_BATCH` caps the damage per request in the meantime.
 */

import express, { Router } from "express";
import type { Request, Response } from "express";

import { SESSION_HEADER } from "../sessions/sessionMiddleware.js";
import type { NewAnalyticsEvent } from "../store/ports.js";
import type { EventSink } from "./sink.js";
import { isClientReportable, isEventName, resolveOccurredAt, sanitizeProps } from "./events.js";

/** Max events accepted per request. The client flushes well below this. */
const MAX_BATCH = 50;

/** Max length of the incidental id fields a client may attach. */
const MAX_ID_LEN = 64;

function optionalId(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_ID_LEN) return undefined;
  return raw;
}

export function createEventRouter(sink: EventSink): Router {
  const router = Router();

  // `sendBeacon` sends `text/plain` so the request stays CORS-simple — a
  // preflight is exactly what a page being torn down has no time to complete.
  // The app-level `express.json()` ignores that content type, so this route
  // parses it too. Scoped here rather than globally: no other endpoint should
  // start accepting JSON smuggled under a `text/plain` header.
  router.use("/events", express.json({ type: ["application/json", "text/plain"] }));

  router.post("/events", async (req: Request, res: Response) => {
    const body = req.body as { events?: unknown; sessionToken?: unknown };

    // A `sendBeacon` flush on page hide cannot set headers, so the client puts
    // its token in the body. Same secret, same trust level — just the only
    // place a beacon can carry it. The header still wins when both are present.
    const headerToken = req.headers[SESSION_HEADER];
    const bodyToken = body?.sessionToken;
    const ownerToken =
      typeof headerToken === "string" && headerToken.length > 0
        ? req.sessionToken
        : typeof bodyToken === "string" && bodyToken.length > 0 && bodyToken.length <= MAX_ID_LEN
          ? bodyToken
          : req.sessionToken;

    if (!ownerToken) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const raw = body?.events;

    if (!Array.isArray(raw)) {
      res.status(400).json({ error: "INVALID_REQUEST" });
      return;
    }
    if (raw.length > MAX_BATCH) {
      res.status(413).json({ error: "BATCH_TOO_LARGE", max: MAX_BATCH });
      return;
    }

    const now = new Date();
    const accepted: NewAnalyticsEvent[] = [];
    let dropped = 0;

    for (const item of raw) {
      if (typeof item !== "object" || item === null) {
        dropped++;
        continue;
      }
      const e = item as Record<string, unknown>;

      const name = e["name"];
      if (!isEventName(name) || !isClientReportable(name)) {
        dropped++;
        continue;
      }

      const props = sanitizeProps(e["props"]);
      if (!props.ok) {
        dropped++;
        continue;
      }

      const gameId = optionalId(e["gameId"]);
      const shareLinkId = optionalId(e["shareLinkId"]);
      if (gameId === undefined || shareLinkId === undefined) {
        dropped++;
        continue;
      }

      accepted.push({
        name,
        ownerToken,
        gameId,
        shareLinkId,
        props: props.value,
        createdAt: resolveOccurredAt(e["occurredAt"], now),
      });
    }

    await sink.record(accepted);

    // 202, not 201: the sink has accepted responsibility for these, but it is
    // explicitly allowed to drop them rather than fail (see `createStoreSink`),
    // so promising they were created would be a lie.
    res.status(202).json({ accepted: accepted.length, dropped });
  });

  return router;
}
