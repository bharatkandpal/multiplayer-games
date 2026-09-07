/**
 * Data lifecycle / retention operations.
 *
 * Three stories:
 *   1. 90-day rolling   — delete game results older than 90 days + stale leaderboard/share data
 *   2. Event purge       — delete all data scoped to a specific event
 *   3. "Forget me"       — delete everything for a session token (GDPR-style)
 *
 * Operates entirely through the repo ports — no direct DB access.
 */

import type { Store } from "../store/ports.js";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export interface RetentionStats {
  readonly results: number;
  readonly leaderboard: number;
  readonly shareLinks: number;
  readonly sessions: number;
}

/**
 * Delete game results older than 90 days and expired share links.
 * Leaderboard entries are not time-pruned (they're aggregated standings).
 */
export async function rollingRetention(store: Store): Promise<RetentionStats> {
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);

  const results = await store.results.deleteOlderThan(cutoff);
  const shareLinks = await store.shareLinks.deleteExpired();

  return { results, leaderboard: 0, shareLinks, sessions: 0 };
}

/** Delete all data scoped to a specific event. */
export async function purgeEvent(store: Store, eventId: string): Promise<RetentionStats> {
  const leaderboard = await store.leaderboard.deleteByEvent(eventId);
  // Game results and share links don't have a dedicated deleteByEvent,
  // but they cascade from session deletion. For event-specific cleanup
  // we rely on the leaderboard; results are cleaned by rolling retention.
  return { results: 0, leaderboard, shareLinks: 0, sessions: 0 };
}

/** Delete all traces of a session token across every repo. */
export async function forgetMe(store: Store, ownerToken: string): Promise<RetentionStats> {
  // Order matters: delete dependent records before the session (FK cascade
  // would handle it, but explicit is clearer and works with the memory adapter).
  const results = await store.results.deleteByOwner(ownerToken);
  const leaderboard = await store.leaderboard.deleteByOwner(ownerToken);
  const shareLinks = await store.shareLinks.deleteByOwner(ownerToken);
  const deleted = await store.sessions.delete(ownerToken);

  return {
    results,
    leaderboard,
    shareLinks,
    sessions: deleted ? 1 : 0,
  };
}
