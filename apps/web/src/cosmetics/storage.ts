/**
 * Cosmetic persistence — client-only for L1 (MPG-088-a), keyed per game.
 *
 * Same best-effort contract the Drunk Walk character had: every failure path
 * (private browsing, disabled storage, corrupt JSON, SSR, a schema that has
 * since changed) degrades to defaults rather than throwing. Customization is a
 * nice-to-have and is never worth breaking a game over.
 *
 * Deliberately NOT on the session record yet. Client-only is enough to render,
 * and it keeps the server out of it until MPG-089 needs a variant to be owned
 * and shareable — at which point this module is the seam that grows a remote
 * backend, not every call site.
 */

import { defaultConfig, defaultOption } from "./registry";
import type { CosmeticConfig, CosmeticSchema } from "./types";

/** Namespaced per game so two games' picks can't collide. */
function storageKey(gameId: string): string {
  return `mpg:cosmetics:${gameId}`;
}

/**
 * Coerces arbitrary stored JSON into a config valid against `schema` — every
 * slot present, every value a real option id. Unknown slots in the stored data
 * are dropped and unknown option ids fall back to the slot default, so removing
 * a hat or renaming a palette in a later release silently repairs old saves
 * instead of stranding them.
 */
function reconcile(schema: CosmeticSchema, stored: unknown): CosmeticConfig {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return defaultConfig(schema);
  }
  const raw = stored as Record<string, unknown>;
  const config: Record<string, string> = {};
  for (const slot of schema.slots) {
    const value = raw[slot.id];
    const known = typeof value === "string" && slot.options.some((o) => o.id === value);
    config[slot.id] = known ? value : defaultOption(slot).id;
  }
  return config;
}

/** The player's saved picks for `schema`'s game, defaulted and repaired. */
export function loadCosmetics(schema: CosmeticSchema): CosmeticConfig {
  try {
    const raw = window.localStorage.getItem(storageKey(schema.gameId));
    if (!raw) return defaultConfig(schema);
    return reconcile(schema, JSON.parse(raw));
  } catch {
    return defaultConfig(schema);
  }
}

/** Best-effort save. A failed write just means the pick won't outlive the tab. */
export function storeCosmetics(gameId: string, config: CosmeticConfig): void {
  try {
    window.localStorage.setItem(storageKey(gameId), JSON.stringify(config));
  } catch {
    // Intentionally swallowed — see the module comment.
  }
}

/** Forgets a game's saved cosmetics (used by the session "forget me" path). */
export function clearCosmetics(gameId: string): void {
  try {
    window.localStorage.removeItem(storageKey(gameId));
  } catch {
    // Intentionally swallowed — see the module comment.
  }
}
