/**
 * The event taxonomy (MPG-097) — the closed set of things the funnel counts.
 *
 * A closed set, not an open string, on purpose. Free-form event names rot into
 * `share_click` / `shareClicked` / `share-clicked` within a month and every
 * funnel query silently undercounts. Adding an event here is a deliberate act
 * with a name review attached; anything not on this list is rejected at the
 * door rather than quietly stored and forgotten.
 *
 * Slice 1 covers legs 4–5 — the ones already live and losing data. Variant
 * saves, forks, and the D1/D7 retention query are later slices.
 */

export const EVENT_NAMES = [
  /** A finished game was persisted. Denominator for share rate. Server-side. */
  "result_saved",
  /** A durable share link was minted. Numerator for share rate. Server-side. */
  "share_minted",
  /** A share link was resolved — i.e. someone opened it. Numerator for CTR. Server-side. */
  "share_opened",
  /**
   * First real input of a session that arrived via a share link. The whole
   * point of leg 5: a cold visitor's time-to-first-input. Client-side, because
   * the server cannot see when a finger touched the board.
   */
  "first_input",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && (EVENT_NAMES as readonly string[]).includes(value);
}

/**
 * Events the client is allowed to report.
 *
 * Everything else on the list is server-side truth. Accepting `share_minted`
 * from a browser would mean the share rate could be inflated by anyone with
 * `curl`, and — more mundanely — double-counted the moment a retry fires. The
 * server already knows when it minted a link; it does not need to be told.
 */
const CLIENT_REPORTABLE: readonly EventName[] = ["first_input"];

export function isClientReportable(name: EventName): boolean {
  return CLIENT_REPORTABLE.includes(name);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Max number of keys in a `props` bag. Keeps a stray object from becoming a blob. */
const MAX_PROP_KEYS = 8;
/** Max length of a string prop value. Long enough for an id, too short for prose. */
const MAX_PROP_STRING_LEN = 64;

export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue>;

/**
 * Validate a `props` bag: small scalars only.
 *
 * This is the privacy boundary, not a convenience check. Rejecting objects and
 * long strings is what stops a URL, a user agent, or a typed message from ever
 * reaching the events table — the taxonomy above says *what* we count, and this
 * says *how little* we are willing to know about each occurrence. Non-finite
 * numbers are rejected too, since `NaN`/`Infinity` do not survive JSON round
 * trips and would land as `null`.
 */
export function sanitizeProps(raw: unknown): { ok: true; value: Props | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false };

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_PROP_KEYS) return { ok: false };

  const out: Props = {};
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > MAX_PROP_STRING_LEN) return { ok: false };

    if (typeof value === "string") {
      if (value.length > MAX_PROP_STRING_LEN) return { ok: false };
      out[key] = value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) return { ok: false };
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else {
      return { ok: false };
    }
  }

  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

/** How far in the past a client may backdate an event. Generous: a batch can wait out a tab freeze. */
const MAX_BACKDATE_MS = 6 * 60 * 60 * 1000; // 6h
/** How far ahead a client timestamp may sit before we distrust its clock. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000; // 5m

/**
 * Resolve a client-supplied occurrence time against the server clock.
 *
 * Client clocks are wrong — skewed, frozen with the tab, occasionally set to
 * 1970. Rather than reject those events (losing exactly the data this task
 * exists to stop losing), an out-of-range timestamp falls back to server-now.
 * Undercounting a stale batch is a smaller lie than a funnel with events in
 * 1970 skewing every window query.
 */
export function resolveOccurredAt(raw: unknown, now: Date): Date {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return now;

  const nowMs = now.getTime();
  if (raw > nowMs + MAX_FUTURE_SKEW_MS) return now;
  if (raw < nowMs - MAX_BACKDATE_MS) return now;

  return new Date(raw);
}
