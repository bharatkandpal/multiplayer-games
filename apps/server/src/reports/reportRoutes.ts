/**
 * `POST /api/report` — player-filed reports about authored content (MPG-092 slice 2).
 *
 * A report is a **review queue entry, not an enforcement action**: filing one
 * hides nothing and blocks nobody. A human reviewer (MPG-103/104) decides what
 * happens; for L1/L2 this endpoint is queue-only, deliberately with no
 * auto-hide threshold. That keeps a report from becoming a griefing lever — you
 * cannot make a name disappear by reporting it enough times.
 *
 * Session-scoped (owner = the reporting session's token) and rate-limited via
 * the `report_name` policy, so one session can't flood the queue. Mounted
 * behind `createSessionMiddleware`, so `req.sessionToken` is always set.
 *
 * Offline pillar: reporting is an enhancement layered on the session token —
 * nothing here is on the path of playing. Bad input is rejected with a 400 and
 * a code (never a 5xx); the client (a later slice) simply omits the affordance
 * when the backend is unreachable.
 */

import { Router } from "express";
import type { Request, Response } from "express";

import { noopLimit, type RateLimitFor } from "../middleware/rateLimit.js";
import type { NewReport, Store } from "../store/ports.js";

/**
 * The reportable surfaces that exist at L1/L2 — the only user-authored content.
 * `variant_name` joined when MPG-089-b landed the variant-save path; its
 * `targetId` is a variant id (a reviewer resolves it to the offending name).
 */
const REPORT_KINDS = new Set(["username", "handle", "variant_name"]);

/** Targets are ids of existing rows; the real ones are UUIDs, well under this. */
const MAX_TARGET_ID_LEN = 64;

/** A reviewer note, not an essay. Long enough to explain, capped so it can't be abused as storage. */
const MAX_REASON_LEN = 280;

export function createReportRouter(store: Store, limit: RateLimitFor = noopLimit): Router {
  const router = Router();

  router.post("/report", limit("report_name"), async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const body = req.body as { kind?: unknown; targetId?: unknown; reason?: unknown } | undefined;

    const kind = body?.kind;
    if (typeof kind !== "string" || !REPORT_KINDS.has(kind)) {
      res.status(400).json({ error: "INVALID_REPORT", reason: "kind" });
      return;
    }

    const targetId = body?.targetId;
    if (
      typeof targetId !== "string" ||
      targetId.length === 0 ||
      targetId.length > MAX_TARGET_ID_LEN
    ) {
      res.status(400).json({ error: "INVALID_REPORT", reason: "targetId" });
      return;
    }

    // Reason is optional. When present it must be a bounded string; an empty or
    // whitespace-only note is treated as "no reason given" rather than an error.
    let reason: string | null = null;
    const rawReason = body?.reason;
    if (rawReason !== undefined && rawReason !== null) {
      if (typeof rawReason !== "string" || rawReason.length > MAX_REASON_LEN) {
        res.status(400).json({ error: "INVALID_REPORT", reason: "reason" });
        return;
      }
      const trimmed = rawReason.trim();
      reason = trimmed.length > 0 ? trimmed : null;
    }

    const report: NewReport = { kind, targetId, reason, reporterToken: token };
    await store.reports.create(report);

    // 201: a durable queue row was created. We do NOT echo its id — the reporter
    // has no use for it, and it authorizes nothing.
    res.status(201).json({ ok: true });
  });

  return router;
}
