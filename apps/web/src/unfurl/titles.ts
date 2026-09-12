/**
 * Game id → display title, for the unfurl shim (MPG-086 / ADR 0009).
 *
 * ADR 0009 says the shim must reuse the existing title copy rather than
 * re-author it, so the card image and the unfurl text can never drift. The
 * server's card renderer reads `apps/server/src/cards/titles.ts` — but the shim
 * runs at the *frontend* host and the import boundary is one-way (apps/web never
 * imports the server). The boundary-correct twin of that source is this app's own
 * `catalog.ts`, which already carries the same human titles (and is itself,
 * deliberately, the thing `cards/titles.ts` is a duplicate of). So we read the
 * catalog here instead of copying strings.
 */

import { GAME_CATALOG, REALTIME_CATALOG } from "../screens/catalog";

/**
 * The 2048 grid-size variants share one base title but distinct ids
 * (`2048@3`, `2048@5` — MPG-096). The catalog is keyed by the base id, so we
 * split the suffix off, look up the base, and re-attach the size — matching the
 * server's `cards/titles.ts` entries (`"2048 (3×3)"`) rather than falling back
 * to the raw slug.
 */
function baseTitle(gameId: string): string | undefined {
  const entry =
    (GAME_CATALOG as Record<string, { title: string } | undefined>)[gameId] ??
    (REALTIME_CATALOG as Record<string, { title: string } | undefined>)[gameId];
  return entry?.title;
}

/**
 * The title a player sees for `gameId`, falling back to the raw id.
 *
 * The fallback is honest, not defensive (same stance as the server): a share for
 * a game this build doesn't know still unfurls with a real score, it just names
 * the game by its slug. Refusing to render would turn a missing table entry into
 * a broken preview — a far worse trade for a cosmetic label.
 */
export function gameTitle(gameId: string): string {
  const direct = baseTitle(gameId);
  if (direct) return direct;

  const at = gameId.indexOf("@");
  if (at > 0) {
    const base = baseTitle(gameId.slice(0, at));
    const size = gameId.slice(at + 1);
    if (base && /^\d+$/.test(size)) return `${base} (${size}×${size})`;
  }

  return gameId;
}
