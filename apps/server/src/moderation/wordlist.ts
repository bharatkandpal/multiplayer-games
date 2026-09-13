/**
 * Blocklists for text moderation (MPG-092).
 *
 * Deliberately small and curated, not exhaustive. The task's brief is "cheap
 * and sufficient": at L1/L2 the only user-authored text is a handle and a
 * variant name, so this is the entire moderation surface until L3. It runs
 * fully in-process — no network, no vendor call — so it can never become a
 * dependency that violates the offline pillar (docs/UX_PRINCIPLES.md §7).
 *
 * Matching is done against a *normalised* form of the input (lower-cased,
 * de-leetspeaked, separators stripped — see `normalise` in `moderate.ts`), so
 * these entries are the normalised spellings only. Keep them lower-case,
 * alphabetic, with no separators.
 */

/**
 * Profanity / slurs. Matched as a substring of the fully-collapsed input, which
 * catches obfuscations like `f_u_c_k` and `sh1t` but accepts the Scunthorpe
 * tradeoff (an innocent word that embeds one of these is blocked). The list is
 * kept short and strong on purpose to minimise that class of false positive;
 * grow it deliberately, not casually. The audience explicitly includes kids.
 */
export const PROFANITY: readonly string[] = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "asshole",
  "dick",
  "piss",
  "bastard",
  "slut",
  "whore",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "cum",
  "rape",
  "nazi",
];

/**
 * Reserved / impersonation-prone names. Matched against the input's
 * alphabetic-only collapse by *equality* (so `admin`, `a-d-m-i-n` and `admin`
 * with trailing digits stripped all resolve to `admin`) — an impersonation
 * check, not a substring ban, so `administrating_ada` is fine but `admin` and
 * `admin123` are not.
 */
export const RESERVED: readonly string[] = [
  "admin",
  "administrator",
  "official",
  "staff",
  "moderator",
  "mod",
  "support",
  "help",
  "system",
  "root",
  "owner",
  "server",
  "bot",
  "mpg",
  "multiplayergames",
];
