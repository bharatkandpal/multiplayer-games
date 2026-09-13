/**
 * Session HTTP endpoints.
 *
 * Mounted behind `createSessionMiddleware` — every request already has
 * `req.sessionToken` resolved (minted if this is the first visit).
 */

import { Router } from "express";
import type { Request, Response } from "express";

import { noopLimit, type RateLimitFor } from "../middleware/rateLimit.js";
import { moderateText } from "../moderation/index.js";
import { forgetMe } from "../retention/retention.js";
import type { Store } from "../store/ports.js";
import { SESSION_COOKIE } from "./sessionMiddleware.js";

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

function parseNonNegativeInt(raw: unknown, fallback: number, max?: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return typeof max === "number" ? Math.min(parsed, max) : parsed;
}

export function createSessionRouter(store: Store, limit: RateLimitFor = noopLimit): Router {
  const router = Router();

  // GET /api/session — current (or newly-minted) session identity.
  router.get("/session", async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(500).json({ error: "session_unavailable" });
      return;
    }

    const session = await store.sessions.findByToken(token);
    res.json({
      token,
      username: session?.username ?? null,
      createdAt: (session?.createdAt ?? new Date()).toISOString(),
    });
  });

  // POST /api/session/username — claim/update a case-insensitively unique username.
  router.post("/session/username", limit("username_set"), async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const body = req.body as { username?: unknown } | undefined;

    // Format caps + profanity + impersonation, server-side and authoritative
    // (MPG-092). Pure/in-process, so it never blocks on a vendor or the network.
    const moderated = moderateText("handle", body?.username);
    if (!moderated.ok) {
      res.status(400).json({ error: "INVALID_USERNAME", reason: moderated.reason });
      return;
    }

    await store.sessions.upsert(token);
    const result = await store.sessions.setUsername(token, moderated.value);
    if (!result.ok) {
      res.status(409).json({ error: "USERNAME_TAKEN" });
      return;
    }

    res.json({ token, username: result.session.username });
  });

  // DELETE /api/session — "forget me": erase all data owned by this token.
  router.delete("/session", async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const stats = await forgetMe(store, token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ deleted: stats });
  });

  // GET /api/session/history — paginated game results for this session.
  router.get("/session/history", async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const limit = parseNonNegativeInt(req.query["limit"], DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
    const offset = parseNonNegativeInt(req.query["offset"], 0);

    const results = await store.results.findByOwner(token, { limit, offset });
    res.json({ results });
  });

  return router;
}
