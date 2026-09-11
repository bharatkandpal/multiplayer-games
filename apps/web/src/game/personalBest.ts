/**
 * The player's best score per real-time game — client-only, best-effort.
 *
 * Deliberately NOT the leaderboard. The leaderboard is the server's view and
 * needs a round-trip; this is the player's own view of their own runs, and Home
 * renders it on first paint with the backend unplugged. Reading a rank from the
 * network to decorate a game card would make the catalogue depend on a service
 * the game doesn't need (offline pillar, `docs/UX_PRINCIPLES.md` §7) — so the
 * chip is sourced locally and simply isn't offered when there's no local best.
 *
 * Same contract as `cosmetics/storage`: every failure path (private browsing,
 * disabled storage, corrupt JSON, SSR) degrades to "no best recorded" rather
 * than throwing. A best score is an ornament; it is never worth an error.
 *
 * All three real-time games score higher-is-better (Reflex Test scores the
 * margin under its baseline, not the raw time), so `max` is the right merge for
 * every game we have. A lower-is-better game would need a per-game comparator —
 * `RealtimeModule` is where that would belong, not here.
 */

import type { RealtimeGameId } from "@mpg/engine";

/** Namespaced per game so two games' bests can't collide. */
function storageKey(gameId: RealtimeGameId): string {
  return `mpg:best:${gameId}`;
}

/** The player's best recorded score for `gameId`, or `undefined` if none. */
export function loadPersonalBest(gameId: RealtimeGameId): number | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey(gameId));
    if (raw === null) return undefined;
    const value = Number(raw);
    // Rejects "", "abc", Infinity and NaN in one check — a corrupt or
    // hand-edited entry reads as "no best" instead of rendering "NaN".
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Records `score` if it beats the stored best. Returns the best after the
 * write, so a caller can tell the player they just beat it without re-reading.
 */
export function recordPersonalBest(gameId: RealtimeGameId, score: number): number {
  const previous = loadPersonalBest(gameId);
  const best = previous === undefined ? score : Math.max(previous, score);
  if (best === previous) return best;
  try {
    window.localStorage.setItem(storageKey(gameId), String(best));
  } catch {
    // Intentionally swallowed — see the module comment.
  }
  return best;
}

/** Forgets a game's best (used by the session "forget me" path). */
export function clearPersonalBest(gameId: RealtimeGameId): void {
  try {
    window.localStorage.removeItem(storageKey(gameId));
  } catch {
    // Intentionally swallowed — see the module comment.
  }
}
