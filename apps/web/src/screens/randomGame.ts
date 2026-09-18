// "Surprise me" — the random game picker (MPG-143).
//
// A sibling of `gameOfTheDay.ts`, and deliberately its opposite number. Game of
// the Day must be STABLE within a day (a pick that reshuffles on every render
// makes the "of the day" framing a lie), so it is a pure function of the
// calendar. This one must be UNSTABLE on purpose — pressing the dice twice and
// getting the same game twice is the one outcome that makes the button feel
// broken. Same seam either way: a list in, one pick out.
//
// Everything here is pure and synchronous. The pick is decided BEFORE any
// animation runs (see `SurpriseMe` in HomeScreen), so the shuffle is decoration
// over a settled decision rather than the thing that makes it — which is what
// keeps the spin skippable at any moment without changing the outcome.

/** An item this picker can choose between: anything with a stable id. */
interface Identified {
  readonly id: string;
}

export interface RandomGameOptions {
  /**
   * The id the player just got — excluded from the draw so the dice never lands
   * twice in a row on the same game. Ignored when it's the only candidate:
   * "no game" is a worse answer than "the same game again".
   */
  readonly exclude?: string | undefined;
  /**
   * The randomness. Injected so tests are deterministic and so the picker itself
   * stays pure — the same reason the engine's AI takes an `Rng` rather than
   * reaching for `Math.random`.
   */
  readonly random?: () => number;
}

/**
 * A uniformly-random item from `items`, or `undefined` when there are none.
 *
 * The caller decides what goes in — Home passes the games currently VISIBLE, so
 * an active tag filter narrows the draw. That matters: a player who has just
 * filtered to "Quick" has told us what they want, and throwing them into an
 * endless game would be the button ignoring the only instruction it was given.
 */
export function pickRandomGame<T extends Identified>(
  items: readonly T[],
  options: RandomGameOptions = {},
): T | undefined {
  if (items.length === 0) return undefined;

  const random = options.random ?? Math.random;
  const candidates =
    options.exclude === undefined ? items : items.filter((item) => item.id !== options.exclude);
  // Excluding the last pick can empty the list (a one-game catalogue, or a
  // filter that matches one game). Fall back to the full list rather than
  // returning nothing — a dead button is worse than a repeat.
  const pool = candidates.length > 0 ? candidates : items;

  // `Math.min` guards the `random() === 1` case some custom RNGs allow, which
  // would otherwise index one past the end.
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index];
}
