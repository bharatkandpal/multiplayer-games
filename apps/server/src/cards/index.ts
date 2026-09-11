/**
 * Share/result card rendering (MPG-085-a) — `renderResultCard(result) → SVG string`.
 *
 * Leg 5 of the loop is "win → share", and today a shared link unfurls as a bare URL in
 * every client it lands in. This module is the picture that fixes that. It does not
 * serve anything: MPG-085-b owns `GET /api/cards/:token.png`, the rasteriser, and the
 * immutable caching, and MPG-086 owns the `og:*` tags that point at it.
 *
 * ## Why SVG markup, and no dependency
 *
 * The ticket left the rasteriser open (resvg / sharp / satori) and parked this slice
 * behind that choice. Splitting it this way resolves the block rather than deferring it:
 *
 *  • **Determinism is the point.** The card's contract — same result in, byte-identical
 *    card out — is what makes 085-b's `immutable, max-age=1y` sound. A hand-built string
 *    gives that by construction. Satori would not: its output moves with its own version
 *    and embedded font metrics, so "byte-identical" would become "byte-identical until
 *    the next `pnpm up`", which is not a cache key you can trust forever.
 *  • **The choice stays open.** SVG → PNG is what resvg and sharp both do, so this
 *    module is their input either way. Only satori would have replaced it, and satori is
 *    the option that costs determinism.
 *  • **Nothing needs a raster yet.** `og:image` does need PNG — scrapers do not render
 *    SVG — but nothing consumes a card until 085-b, so the dependency is best added in
 *    the slice that actually serves bytes.
 *
 * ## Adding a card for a game
 *
 * Register it in `CARD_RENDERERS` below. That is the whole contract — no core file
 * changes, same shape as the engine's game registry. A game without an entry gets the
 * generic card for its family, which is a real card, not a placeholder: the fallback is
 * why every one of the eight games in the catalogue unfurls properly from day one, with
 * only Drunk Walk bespoke so far.
 */

import { renderDrunkWalkCard } from "./drunkWalkCard.js";
import { renderRealtimeCard, renderTurnBasedCard } from "./genericCards.js";
import type { CardRenderer, ResultCardInput } from "./types.js";

/**
 * Per-game card renderers. Partial by design — a missing entry is the normal case,
 * not a gap to be filled before shipping.
 */
export const CARD_RENDERERS: Readonly<Record<string, CardRenderer>> = {
  "drunk-walk": renderDrunkWalkCard,
};

/**
 * Renders the share card for a finished result.
 *
 * Pure: no I/O, no clock, no randomness. Every visible value comes from `result`, which
 * is what lets a caller cache the output against the result id and never look again.
 *
 * Family is taken from `gameFamily` but falls back to the presence of a `score`, because
 * that column is the one thing that reliably separates the two families on older rows —
 * and a card that picked the wrong ground would still be a perfectly readable card,
 * which is the right failure mode for a cosmetic choice.
 */
export function renderResultCard(result: ResultCardInput): string {
  const bespoke = CARD_RENDERERS[result.gameId];
  if (bespoke) return bespoke(result);

  const isRealtime =
    result.gameFamily === "realtime" ||
    (result.gameFamily !== "turn-based" && result.score !== null);

  return isRealtime ? renderRealtimeCard(result) : renderTurnBasedCard(result);
}

export type { CardRenderer, ResultCardInput } from "./types.js";
export { CARD_HEIGHT, CARD_WIDTH } from "./svg.js";
