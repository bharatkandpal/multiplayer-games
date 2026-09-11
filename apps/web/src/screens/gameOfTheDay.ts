// "Game of the Day" — a deliberately trivial recommender.
//
// A real recommendation engine (personalized, signal-driven) is a separate piece
// of work. For now Home just spotlights one game a day. The contract this file
// establishes is the seam that engine will slot into: `pickGameOfTheDay(items,
// date)` in, one `GameItem` out. Swap the body, keep the signature.
//
// Two properties matter and neither needs anything more than arithmetic:
//   1. *Stable within a day* — it must not reshuffle on every render, or the
//      "of the day" framing is a lie and focus/scroll jump around. So the pick
//      is a pure function of the calendar day, not `Math.random()`.
//   2. *Moves on its own* — a different game surfaces tomorrow without a deploy,
//      and it walks the whole catalog over time rather than favouring index 0.

import type { GameItem } from "./catalog";

/**
 * The catalog day-index: whole days since the Unix epoch in the runtime's local
 * time zone. Local (not UTC) so the spotlight flips at the player's local
 * midnight — "game of *the day*" should track the day they're actually in.
 */
function dayOrdinal(date: Date): number {
  // Zero the clock in local time, then convert to a day count. Using the local
  // Y/M/D avoids the DST-hour drift a plain `getTime() / 86_400_000` would hit.
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor(local.getTime() / 86_400_000);
}

/**
 * The spotlighted game for `date`, or `undefined` when the catalog is empty.
 *
 * Deterministic: the same day always yields the same game, so every render and
 * every player on that calendar day sees one consistent pick. The stride below
 * (a step coprime-ish with typical small catalog sizes) walks the list across
 * days instead of stepping 0,1,2… so consecutive days feel varied even as the
 * catalog grows.
 */
export function pickGameOfTheDay(items: GameItem[], date: Date = new Date()): GameItem | undefined {
  if (items.length === 0) return undefined;
  // `((n % m) + m) % m` keeps the index non-negative for pre-epoch dates.
  const index = (((dayOrdinal(date) * 7) % items.length) + items.length) % items.length;
  return items[index];
}
