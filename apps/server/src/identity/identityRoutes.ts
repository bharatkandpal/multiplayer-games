/**
 * Claimable-handle HTTP endpoints (MPG-091, slice 1 — device-key + recovery code).
 *
 * Anonymous-first is preserved: these endpoints are an *upgrade* layered on top
 * of the session token. Nothing here gates play; the client (slice -c) offers
 * the claim only after the player has something worth keeping, and simply omits
 * the affordance when the backend is unreachable (offline pillar).
 *
 * Mounted behind `createSessionMiddleware`, so `req.sessionToken` is always set
 * and its session row already upserted.
 */

import { Router } from "express";
import type { Request, Response } from "express";

import { noopLimit, type RateLimitFor } from "../middleware/rateLimit.js";
import { moderateText } from "../moderation/index.js";
import type { Store } from "../store/ports.js";
import {
  RECOVERY_CODE_LENGTH,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "./recoveryCode.js";

export function createIdentityRouter(store: Store, limit: RateLimitFor = noopLimit): Router {
  const router = Router();

  // GET /api/identity — the current session's claimed handle, or null.
  router.get("/identity", async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }
    const identity = await store.identities.findByToken(token);
    res.json({ handle: identity?.handle ?? null, claimed: identity !== undefined });
  });

  // POST /api/identity/claim — mint a durable identity for this session.
  router.post("/identity/claim", limit("identity_claim"), async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const body = req.body as { handle?: unknown } | undefined;

    // Same authoritative, in-process check handles/usernames already use
    // (MPG-092) — length caps, profanity, impersonation. Never a network call.
    const moderated = moderateText("handle", body?.handle);
    if (!moderated.ok) {
      res.status(400).json({ error: "INVALID_HANDLE", reason: moderated.reason });
      return;
    }

    // The plaintext code exists only on this stack frame and in the response;
    // the store sees only its hash.
    const recoveryCode = generateRecoveryCode();
    const result = await store.identities.claim(
      token,
      moderated.value,
      hashRecoveryCode(recoveryCode),
    );

    if (!result.ok) {
      if (result.reason === "handle_taken") {
        res.status(409).json({ error: "HANDLE_TAKEN" });
        return;
      }
      res.status(409).json({ error: "ALREADY_CLAIMED" });
      return;
    }

    // `recoveryCode` is returned exactly once — it is never retrievable again.
    res.status(201).json({ handle: result.identity.handle, recoveryCode });
  });

  // POST /api/identity/adopt — link this session to an existing identity by code.
  router.post("/identity/adopt", limit("identity_adopt"), async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const body = req.body as { recoveryCode?: unknown } | undefined;
    const raw = body?.recoveryCode;
    // Guard before hashing: a wrong-shaped value can never match, and this keeps
    // a junk payload from reaching the store at all. Never 5xx on bad input.
    if (typeof raw !== "string" || normalizeRecoveryCode(raw).length !== RECOVERY_CODE_LENGTH) {
      res.status(400).json({ error: "INVALID_RECOVERY_CODE" });
      return;
    }

    const result = await store.identities.adopt(token, hashRecoveryCode(raw));
    if (!result.ok) {
      res.status(400).json({ error: "INVALID_RECOVERY_CODE" });
      return;
    }

    res.json({ handle: result.identity.handle });
  });

  return router;
}
