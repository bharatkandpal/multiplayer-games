// A small, fixed roster of bot names so a bot opponent reads as a named
// character ("Mia's turn", "Leo wins!") rather than the anonymous "Bot". Five
// masculine + five feminine, kept short and neutral. Purely cosmetic — a name
// never touches game logic, difficulty, or the seat model.

export const MALE_BOT_NAMES = ["Leo", "Max", "Kai", "Theo", "Sam"] as const;
export const FEMALE_BOT_NAMES = ["Mia", "Ava", "Zoe", "Ivy", "Nia"] as const;

/** The full pool both preset groups draw from. */
export const BOT_NAMES: readonly string[] = [...MALE_BOT_NAMES, ...FEMALE_BOT_NAMES];

/** Fallback if the pool is ever empty (it isn't) — keeps the return type total. */
const FALLBACK_BOT_NAME = "Bot";

/**
 * Pick a random name, avoiding any already in `exclude` so two bots in the same
 * game never share one. Falls back to the full pool if every name is excluded
 * (more bots than names — not a real config today, but kept total). `rng` is
 * injectable so tests can make the choice deterministic.
 */
export function pickBotName(
  exclude: ReadonlySet<string> = new Set(),
  rng: () => number = Math.random,
): string {
  const available = BOT_NAMES.filter((name) => !exclude.has(name));
  const pool = available.length > 0 ? available : BOT_NAMES;
  return pool[Math.floor(rng() * pool.length)] ?? FALLBACK_BOT_NAME;
}
