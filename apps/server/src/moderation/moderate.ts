/**
 * Text moderation (MPG-092) — profanity / impersonation checks + length caps
 * for the two user-authored strings in the product: a claimable handle and a
 * variant name.
 *
 * Pure and synchronous. No I/O, no network, no vendor SDK — a bad input is
 * rejected by inspecting the string alone. That is what keeps moderation off
 * the offline-play critical path (docs/UX_PRINCIPLES.md §7): it can run
 * server-side as the authority and, later, client-side for instant feedback,
 * with identical results and no request in flight.
 *
 * The server stays the authority: this module gates the write, it does not
 * merely hint the UI.
 */

import { PROFANITY, RESERVED } from "./wordlist.js";

export type ModerationKind = "handle" | "variant_name";

export type ModerationReason =
  "EMPTY" | "TOO_SHORT" | "TOO_LONG" | "INVALID_CHARS" | "PROFANITY" | "RESERVED";

export type ModerationResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: ModerationReason };

interface KindRules {
  readonly minLength: number;
  readonly maxLength: number;
  /** Allowed characters. Length is checked separately for a precise reason. */
  readonly charset: RegExp;
  /** Whether to run the reserved-name (impersonation) check. */
  readonly checkReserved: boolean;
}

/**
 * Per-kind rules. Handles feed URLs, mentions and unique identities, so they
 * stay tight (matching the historical `^[a-zA-Z0-9_-]{3,20}$`) and are checked
 * for impersonation. Variant names are display-only and roomier, allowing
 * spaces and light punctuation, and are not impersonation-checked (you cannot
 * impersonate staff with a level name).
 */
const RULES: Record<ModerationKind, KindRules> = {
  handle: {
    minLength: 3,
    maxLength: 20,
    charset: /^[a-zA-Z0-9_-]+$/,
    checkReserved: true,
  },
  variant_name: {
    minLength: 1,
    maxLength: 40,
    charset: /^[\p{L}\p{N} '!?.,:_-]+$/u,
    checkReserved: false,
  },
};

/** Common leetspeak substitutions, folded before matching. */
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "l",
};

/**
 * Collapse to a comparison form: lower-case, de-leetspeaked, with everything
 * that is not a latin letter removed. `Sh1t`, `s h i t` and `$hit` all collapse
 * to `shit`; `f_u_c_k` collapses to `fuck`. Used for the profanity substring
 * scan.
 */
function collapse(input: string): string {
  let out = "";
  for (const ch of input.toLowerCase()) {
    const folded = LEET[ch] ?? ch;
    if (folded >= "a" && folded <= "z") out += folded;
  }
  return out;
}

function containsProfanity(input: string): boolean {
  const collapsed = collapse(input);
  return PROFANITY.some((word) => collapsed.includes(word));
}

/** Keep only latin letters, without folding digits — `admin123` → `admin`. */
function lettersOnly(input: string): string {
  let out = "";
  for (const ch of input.toLowerCase()) {
    if (ch >= "a" && ch <= "z") out += ch;
  }
  return out;
}

function isReserved(input: string): boolean {
  // Two collapses, either of which matching a reserved word is impersonation:
  //  - letters-only strips digits/separators: `admin123`, `a.d.m.i.n` → `admin`
  //  - leet-fold catches character swaps: `adm1n` → `admin`
  // `administrating` collapses to itself under both, so it is not reserved.
  return RESERVED.includes(lettersOnly(input)) || RESERVED.includes(collapse(input));
}

/**
 * Moderate a single user-authored string.
 *
 * Returns the (trimmed) value on success, or the first failing reason. Order is
 * deliberate: shape first (empty / length / charset), then content
 * (impersonation, profanity), so callers get the most actionable message.
 */
export function moderateText(kind: ModerationKind, raw: unknown): ModerationResult {
  if (typeof raw !== "string") return { ok: false, reason: "EMPTY" };

  const value = raw.trim();
  const rules = RULES[kind];

  if (value.length === 0) return { ok: false, reason: "EMPTY" };
  if (value.length < rules.minLength) return { ok: false, reason: "TOO_SHORT" };
  if (value.length > rules.maxLength) return { ok: false, reason: "TOO_LONG" };
  if (!rules.charset.test(value)) return { ok: false, reason: "INVALID_CHARS" };

  if (rules.checkReserved && isReserved(value)) return { ok: false, reason: "RESERVED" };
  if (containsProfanity(value)) return { ok: false, reason: "PROFANITY" };

  return { ok: true, value };
}
