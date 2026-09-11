/**
 * CORS origin configuration (MPG-021, docs/TDD.md §11).
 *
 * The app's origin allowlist is an operator concern, supplied via the
 * `CORS_ORIGIN` env var and shared by both the HTTP (`cors`) and Socket.IO
 * transports so the two can never drift.
 */

/**
 * Parse `CORS_ORIGIN` into a value the `cors` package and Socket.IO both accept.
 *
 * - unset / blank → `"*"` (dev-friendly wildcard);
 * - a single origin → that string;
 * - a comma-separated list → an allowlist array;
 * - a list that itself contains `*` → `"*"` (the wildcard wins).
 *
 * Whitespace around entries is trimmed.
 */
export function parseCorsOrigin(raw: string | undefined): string | string[] {
  if (!raw || raw.trim().length === 0) return "*";
  const origins = raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (origins.length === 0) return "*";
  if (origins.includes("*")) return "*";
  return origins.length === 1 ? (origins[0] as string) : origins;
}
