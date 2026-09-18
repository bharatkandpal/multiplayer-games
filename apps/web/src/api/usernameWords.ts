/**
 * Default-username word list (MPG-077 follow-up).
 *
 * A username is auto-assigned the instant someone opens the site, so nobody
 * ever faces an empty "Pick a username" box on a first visit. The name is a
 * combination of one word from each of the two lists below — an adjective and
 * an animal — e.g. `strongWolf`, `crazyCat`, `braveOtter`.
 *
 * Contract (verified by `usernameWords.test.ts`, do not break):
 *   - every word is lowercase ASCII letters only, and
 *   - every `adjective + Animal` combination satisfies the server's username
 *     rule `^[A-Za-z0-9_-]{3,20}$` (see `isValidUsernameFormat`).
 * The second point is why the words are kept short: the longest adjective plus
 * the longest animal must still fit in 20 characters.
 *
 * Casing: the adjective stays lowercase and the animal is capitalised, giving
 * a readable camelCase seam (`strongWolf`) without any separator character.
 */

/** Part 1 — adjectives (≤ 9 letters each, lowercase). */
export const ADJECTIVES: readonly string[] = [
  "brave",
  "calm",
  "clever",
  "cosmic",
  "crazy",
  "dapper",
  "eager",
  "fancy",
  "fearless",
  "fluffy",
  "gentle",
  "giddy",
  "golden",
  "happy",
  "humble",
  "jolly",
  "keen",
  "lucky",
  "mellow",
  "mighty",
  "nimble",
  "noble",
  "plucky",
  "proud",
  "quick",
  "quiet",
  "rapid",
  "royal",
  "shiny",
  "silly",
  "silver",
  "sleepy",
  "snappy",
  "sneaky",
  "spry",
  "stormy",
  "strong",
  "sunny",
  "swift",
  "tidy",
  "vivid",
  "witty",
  "zany",
  "zesty",
] as const;

/** Part 2 — animals (≤ 9 letters each, lowercase). */
export const ANIMALS: readonly string[] = [
  "badger",
  "bison",
  "cat",
  "cobra",
  "crane",
  "dingo",
  "dolphin",
  "eagle",
  "falcon",
  "ferret",
  "finch",
  "fox",
  "gecko",
  "goose",
  "hare",
  "heron",
  "ibis",
  "jackal",
  "koala",
  "lemur",
  "lynx",
  "marmot",
  "moose",
  "narwhal",
  "newt",
  "ocelot",
  "otter",
  "owl",
  "panda",
  "panther",
  "puffin",
  "quokka",
  "rabbit",
  "raven",
  "seal",
  "shark",
  "stork",
  "tapir",
  "tiger",
  "toad",
  "viper",
  "walrus",
  "weasel",
  "wolf",
  "yak",
] as const;

/** Total distinct `adjective + animal` combinations. */
export const USERNAME_COMBINATIONS = ADJECTIVES.length * ANIMALS.length;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)] as T;
}

/**
 * Returns a fresh random default username, e.g. `strongWolf`. Always a valid
 * username (3–20 chars, `[A-Za-z0-9_-]`) by construction — see the file-level
 * contract. Never repeats separators or hits the network.
 */
export function generateUsername(): string {
  return `${pick(ADJECTIVES)}${capitalize(pick(ANIMALS))}`;
}

/**
 * A variant with a small numeric suffix (e.g. `strongWolf47`) used only when a
 * plain generated name collides on the server — it widens the space by ~100×
 * so a silent regenerate reliably lands on a free name without ever prompting
 * an auto-assigned player. Still within the 20-char limit (max base 18 + a
 * 2-digit suffix would be 20; suffix is capped at 2 digits for that reason).
 */
export function generateUsernameWithSuffix(): string {
  const suffix = Math.floor(Math.random() * 90) + 10; // 10–99, always 2 digits
  return `${generateUsername()}${suffix}`;
}
