/**
 * Cross-device owner resolution (MPG-091-b).
 *
 * Every owner-scoped read is anchored on a session token. Once a session is
 * upgraded to a claimed identity, "owned by me" means "owned by any session
 * linked to my identity" — history, leaderboard rank, and (later) shares should
 * all resolve across the player's devices, not just the one they're holding.
 *
 * This is resolved purely at *read* time: claiming or adopting an identity never
 * rewrites the `owner_token` on a single stored row. That keeps the write paths
 * untouched and the offline pillar intact — an unclaimed player is simply the
 * degenerate case of a one-token set, so nothing about anonymous play changes.
 */

import type { Store } from "../store/ports.js";

/**
 * The full set of session tokens whose data belongs to the caller.
 *
 * - Unclaimed session → `[token]` (unchanged single-owner behaviour).
 * - Claimed session   → every token linked to the identity, with `token` always
 *   included even if the link table is momentarily stale, and deduped.
 */
export async function resolveOwnerTokens(store: Store, token: string): Promise<string[]> {
  const identity = await store.identities.findByToken(token);
  if (!identity) return [token];

  const linked = await store.identities.tokensForIdentity(identity.id);
  // Defensive: guarantee the caller's own token is present and the set is unique,
  // so a read never silently drops the very session that issued it.
  return [...new Set([token, ...linked])];
}
