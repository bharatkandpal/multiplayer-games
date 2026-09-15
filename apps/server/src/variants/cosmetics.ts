/**
 * Cosmetics shape + size guard (MPG-089).
 *
 * A variant's `cosmetics` is an **opaque, flat `string→string` map**: a bundle
 * of renderer-only option choices (slot id → option id) authored on the client.
 * The server persists it verbatim and never interprets an id — the meaningful
 * `CosmeticSchema` lives in `apps/web` per the FE/BE import boundary, and a
 * variant authored on a newer client must round-trip through an older server
 * untouched (ADR 0007: variants are data, never code).
 *
 * What the server DOES enforce is structure and bounds, so the `jsonb` column
 * cannot be abused as arbitrary blob storage: a flat object, a handful of
 * short-keyed short-valued string entries, nothing nested. This mirrors the
 * length discipline the moderation layer applies to authored text (MPG-092) —
 * validate the envelope, not the meaning.
 *
 * Pure and synchronous: no I/O, no store access. The save route (MPG-089-b)
 * calls this before persisting and maps a failure to a 4xx; it must never 5xx
 * on a malformed body.
 */

/** A validated cosmetics map: flat, bounded, string→string. */
export type Cosmetics = Readonly<Record<string, string>>;

/** Max number of slot→option entries. Generous for L1; abuse-preventing. */
export const MAX_COSMETIC_SLOTS = 32;

/** Max length of any slot id (key) or option id (value), in characters. */
export const MAX_COSMETIC_ID_LEN = 64;

export type ValidateCosmeticsResult =
  | { readonly ok: true; readonly cosmetics: Cosmetics }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate an untrusted value as a cosmetics map. Returns the value narrowed to
 * `Cosmetics` on success, or a machine-stable `reason` on failure — never
 * throws, so a route can turn any bad input into a 4xx.
 *
 * An empty map (`{}`) is valid: a variant that overrides nothing is still a
 * legitimate "the defaults, but saved and named".
 */
export function validateCosmetics(value: unknown): ValidateCosmeticsResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "cosmetics_not_object" };
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_COSMETIC_SLOTS) {
    return { ok: false, reason: "cosmetics_too_many_slots" };
  }

  for (const [key, val] of entries) {
    if (key.length === 0 || key.length > MAX_COSMETIC_ID_LEN) {
      return { ok: false, reason: "cosmetics_key_length" };
    }
    if (typeof val !== "string") {
      return { ok: false, reason: "cosmetics_value_not_string" };
    }
    if (val.length === 0 || val.length > MAX_COSMETIC_ID_LEN) {
      return { ok: false, reason: "cosmetics_value_length" };
    }
  }

  return { ok: true, cosmetics: value as Cosmetics };
}
