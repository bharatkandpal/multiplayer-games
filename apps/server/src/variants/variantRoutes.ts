/**
 * `POST /api/variants` — save a player-authored variant + auto-mint its share link (MPG-089-b).
 *
 * A variant is a named, owned customization of a base game. At L1 (ADR 0007)
 * the customization is `cosmetics` — a flat, opaque `string→string` map the
 * server stores but never interprets (the `CosmeticSchema` lives in `apps/web`).
 *
 * Saving is one atomic user intent: "make this shareable". So the save
 * **auto-mints** a durable `kind: "variant"` share link in the same request and
 * returns it — there is no second "now share it" step, and no window where a
 * saved variant exists without a link to it. The link reuses the MPG-056
 * share-link layer unchanged (`share_link.kind` is already free-form text), so
 * no schema change was needed. Resolving that link is handled by the share
 * router's `GET /api/share/:token` (a `variant` branch added there).
 *
 * Three authored inputs, three gates, in order of "cheapest / most structural
 * first" so the caller gets the most actionable rejection:
 *   1. `baseGameId` must name a registered game (turn-based OR realtime).
 *   2. `name` passes `moderateText("variant_name", …)` — the same authoritative,
 *      in-process moderation as handles (MPG-092). This discharges the
 *      variant-name half of MPG-092 slice 3.
 *   3. `cosmetics` passes `validateCosmetics` — flat, bounded, string→string.
 *
 * Offline pillar: saving is an enhancement layered on the session token, never
 * on the path of playing. Bad input is a 4xx with a reason code, **never a
 * 5xx**; the client (MPG-089-c) simply omits the save affordance when the
 * backend is unreachable.
 */

import { randomBytes } from "node:crypto";

import { hasGame, hasRealtimeGame, type GameId, type RealtimeGameId } from "@mpg/engine";
import { Router } from "express";
import type { Request, Response } from "express";

import { emit, type EventSink } from "../analytics/sink.js";
import { noopLimit, type RateLimitFor } from "../middleware/rateLimit.js";
import { moderateText } from "../moderation/index.js";
import type { ShareLink, Store, Variant } from "../store/ports.js";
import { validateCosmetics } from "./cosmetics.js";

/**
 * 32 random bytes, base64url — the same unguessable capability token the share
 * router mints. Duplicated (two lines) rather than cross-imported so the two
 * route modules stay decoupled; the format is a shared contract, not shared code.
 */
function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Whether `id` names a registered game (turn-based OR realtime). The engine's
 * id types are closed string-literal unions; membership is a pure `Map.has`, so
 * casting an untrusted string to the union to *ask* is sound — a miss just
 * returns false, which is exactly the "unknown game" rejection we want.
 */
function isRegisteredGame(id: string): boolean {
  return hasGame(id as GameId) || hasRealtimeGame(id as RealtimeGameId);
}

/** The author's view of their freshly-saved variant. Excludes the owner token. */
function toPublicVariant(variant: Variant): Record<string, unknown> {
  return {
    id: variant.id,
    name: variant.name,
    baseGameId: variant.baseGameId,
    cosmetics: variant.cosmetics,
    forkedFrom: variant.forkedFrom,
    createdAt: variant.createdAt.toISOString(),
  };
}

function toPublicLink(link: ShareLink): Record<string, unknown> {
  return {
    token: link.token,
    kind: link.kind,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
  };
}

export function createVariantRouter(
  store: Store,
  sink: EventSink,
  limit: RateLimitFor = noopLimit,
): Router {
  const router = Router();

  router.post("/variants", limit("variant_save"), async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const body = req.body as
      { baseGameId?: unknown; name?: unknown; cosmetics?: unknown } | undefined;

    // 1. Base game must exist. Same 400 shape as the other authored surfaces.
    const baseGameId = body?.baseGameId;
    if (typeof baseGameId !== "string" || !isRegisteredGame(baseGameId)) {
      res.status(400).json({ error: "INVALID_VARIANT", reason: "baseGameId" });
      return;
    }

    // 2. Name — authoritative, in-process moderation (MPG-092). A dedicated
    //    error code so the client can surface the specific moderation reason.
    const moderated = moderateText("variant_name", body?.name);
    if (!moderated.ok) {
      res.status(400).json({ error: "INVALID_VARIANT_NAME", reason: moderated.reason });
      return;
    }

    // 3. Cosmetics — flat/bounded shape guard. Never interprets an option id.
    const cosmetics = validateCosmetics(body?.cosmetics);
    if (!cosmetics.ok) {
      res.status(400).json({ error: "INVALID_VARIANT", reason: cosmetics.reason });
      return;
    }

    const variant = await store.variants.create({
      name: moderated.value,
      ownerToken: token,
      baseGameId,
      cosmetics: cosmetics.cosmetics,
    });

    // Auto-mint: the save IS the "make it shareable" moment. Durable (no expiry).
    const link = await store.shareLinks.create({
      token: mintToken(),
      kind: "variant",
      targetId: variant.id,
      ownerToken: token,
    });

    // Keep the funnel consistent with hand-minted links (MPG-097 leg 4).
    emit(sink, {
      name: "share_minted",
      ownerToken: token,
      shareLinkId: link.id,
      props: { kind: "variant" },
    });

    res.status(201).json({ variant: toPublicVariant(variant), share: toPublicLink(link) });
  });

  return router;
}
