/**
 * `GET /api/cards/:token.png` (MPG-085-b) — the share card as a PNG.
 *
 * This is the image an unfurl points at (ADR 0009): the head-shim sets
 * `og:image` to this URL, and a scraper fetches it to build the rich preview.
 * Like `GET /api/share/:token`, it is **public and session-free** — the token is
 * the capability, and the card is a public projection of the result (see
 * `cards/types.ts`, which withholds the owner token and the move log).
 *
 * Two properties matter:
 *
 *  1. **Immutable caching.** A result never changes and the token is unguessable,
 *     so the PNG is safe to cache forever. That is what keeps the rasteriser off
 *     the hot path — a scraper (and every re-share) hits the CDN, not resvg.
 *  2. **Degrade to absence.** A missing / revoked / expired token, a leaderboard
 *     link (no result to draw), or a render failure answers with a plain 404 — a
 *     scraper simply gets no image and shows the bare link, never a broken
 *     pipeline. The card is an enhancement on the share leg, not a dependency.
 */

import { Router, type Request, type Response } from "express";

import type { Store } from "../store/ports.js";
import { renderResultCardPng } from "./raster.js";

/** One year, in seconds — the immutable cache lifetime for a card. */
const ONE_YEAR_S = 31_536_000;

export function createCardRouter(store: Store): Router {
  const router = Router();

  router.get("/cards/:token.png", async (req: Request, res: Response) => {
    const raw = req.params["token"];
    const token = typeof raw === "string" ? raw : undefined;
    if (!token) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    try {
      // `findByToken` already excludes revoked and expired links, so a null here
      // is the single "dead link" outcome — same as the resolve endpoint.
      const link = await store.shareLinks.findByToken(token);
      // Only result/replay links point at a drawable result; a leaderboard link
      // has no card.
      if (!link || link.kind === "leaderboard") {
        res.status(404).json({ error: "NOT_FOUND" });
        return;
      }

      const result = await store.results.findById(link.targetId);
      if (!result) {
        res.status(404).json({ error: "NOT_FOUND" });
        return;
      }

      // `GameResult` is structurally a `ResultCardInput` (cards/types.ts) — no
      // mapper needed, and the renderer still can't reach the owner token or the
      // move log.
      const png = renderResultCardPng(result);

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", `public, max-age=${ONE_YEAR_S}, immutable`);
      res.send(png);
    } catch (err) {
      // A render failure must not 5xx the unfurl — degrade to no image.
      console.warn("[cards] failed to render card", err);
      res.status(404).json({ error: "NOT_FOUND" });
    }
  });

  return router;
}
