// "Game of the Day" — a deliberately trivial recommender.
//
// A real recommendation engine (personalized, signal-driven) is a separate piece
// of work. For now Home spotlights one game a day. The contract this file
// establishes is the seam that engine will slot into: a list in, one pick out.
// Swap the body, keep the signature.
//
// Two properties matter and neither needs anything more than arithmetic:
//   1. *Stable within a day* — it must not reshuffle on every render, or the
//      "of the day" framing is a lie and focus/scroll jump around. So the pick
//      is a pure function of the calendar day, not `Math.random()`.
//   2. *Moves on its own* — a different game surfaces tomorrow without a deploy,
//      and it walks the whole catalog over time rather than favouring index 0.

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

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

/**
 * A step size, coprime with `length`, used to walk the catalog day over day.
 *
 * A stride only visits every index over time if `gcd(stride, length) === 1`
 * — a fixed stride (e.g. 7) breaks the moment the catalog grows to a length
 * that shares a factor with it (7 and 14 share 7, so a stride of 7 would
 * only ever land on two indices). Deriving the stride from the live length
 * instead — nudging a preferred base up until it's coprime — keeps the walk
 * varied *and* guarantees full coverage for any catalog size. `1` is coprime
 * with everything, so the loop is guaranteed to terminate.
 */
function coprimeStride(length: number): number {
  if (length <= 1) return 1;
  let stride = 7 % length;
  if (stride === 0) stride = 1;
  while (gcd(stride, length) !== 1) {
    stride += 1;
    if (stride >= length) stride = 1;
  }
  return stride;
}

/**
 * The spotlighted item for `date`, or `undefined` when `items` is empty.
 *
 * Generic over anything with an `id` so it works on the whole catalog entry, a
 * lighter `GameItem`, or a test stub alike. Deterministic: the same day always
 * yields the same pick, so every render and every player on that calendar day
 * sees one consistent spotlight. The stride is derived from the live catalog
 * length (see `coprimeStride`) so the pick walks the *entire* list over time,
 * for any catalog size, instead of favouring a subset of indices.
 */
export function pickGameOfTheDay<T>(items: readonly T[], date: Date = new Date()): T | undefined {
  if (items.length === 0) return undefined;
  const stride = coprimeStride(items.length);
  // `((n % m) + m) % m` keeps the index non-negative for pre-epoch dates.
  const index = (((dayOrdinal(date) * stride) % items.length) + items.length) % items.length;
  return items[index];
}
