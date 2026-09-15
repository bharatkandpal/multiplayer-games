/**
 * Client-side claimable-handle API (MPG-091-c) — the client half of the
 * identity endpoints landed in MPG-091-a.
 *
 * Identity is an **upgrade** layered on the anonymous session token, never a
 * gate on play. Everything here degrades to absence: if the backend is
 * unreachable, `fetchIdentity` resolves to `null` (unknown), and the claim
 * affordance is simply not offered — the game is untouched. The only secret,
 * the recovery code, is returned by the server exactly once at claim time and
 * is never retrievable again; we surface it to the player and store nothing
 * but the handle locally (for instant display, no round-trip).
 */

import { apiFetch } from "./session.js";

const HANDLE_STORAGE_KEY = "mpg_handle";

function readStoredHandle(): string | null {
  try {
    const raw = window.localStorage.getItem(HANDLE_STORAGE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    // localStorage can throw (privacy mode, disabled storage, …).
    return null;
  }
}

function writeStoredHandle(handle: string): void {
  try {
    window.localStorage.setItem(HANDLE_STORAGE_KEY, handle);
  } catch {
    // Best-effort only — the handle still works for this tab via the session.
  }
}

/** Synchronously reads the locally-cached claimed handle, if any. No network. */
export function getStoredHandle(): string | null {
  return readStoredHandle();
}

/**
 * Client-side mirror of the server's handle validation (length 3–20,
 * alphanumeric + `_`/`-`). Same contract as the username picker — both go
 * through the server's `moderateText("handle", …)` — so the instant, no-request
 * feedback here matches what the server would accept. Profanity/impersonation
 * remain the server's authoritative call (a 400 with a reason).
 */
const HANDLE_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;
export function isValidHandleFormat(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}

/**
 * Number of significant symbols in a recovery code, and the normaliser — both
 * mirror the server (`identity/recoveryCode.ts`) so the adopt form can reject an
 * obviously wrong-length code without a round-trip. Case, spaces, and grouping
 * dashes are all insignificant.
 */
export const RECOVERY_CODE_LENGTH = 16;
export function normalizeRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function isValidRecoveryCodeFormat(raw: string): boolean {
  return normalizeRecoveryCode(raw).length === RECOVERY_CODE_LENGTH;
}

export interface IdentityState {
  /** The claimed handle, or `null` if this session hasn't claimed one. */
  readonly handle: string | null;
  /** True once this session is linked to a durable identity. */
  readonly claimed: boolean;
}

/**
 * Reads the current session's identity. Resolves to `null` for ANY failure
 * (network error, timeout, 5xx, backend absent) — callers must treat `null` as
 * "unknown / backend unreachable" and degrade to absence, never as an error to
 * surface. A reachable backend with no claim resolves to `{ handle: null,
 * claimed: false }`, which is a definite answer, not a failure.
 */
export async function fetchIdentity(): Promise<IdentityState | null> {
  try {
    const res = await apiFetch("/api/identity");
    if (!res.ok) return null;
    const body = (await res.json()) as { handle: string | null; claimed: boolean };
    if (body.handle) writeStoredHandle(body.handle);
    return { handle: body.handle ?? null, claimed: body.claimed === true };
  } catch {
    return null;
  }
}

export type ClaimResult =
  | { readonly ok: true; readonly handle: string; readonly recoveryCode: string }
  | { readonly ok: false; readonly reason: "taken" | "invalid" | "already_claimed" | "offline" };

/**
 * Claims `handle` for this session, minting a durable identity. On success the
 * server returns the recovery code **exactly once** — the caller must show it
 * and can never fetch it again. Never throws: every non-success maps to a
 * `reason` the UI can phrase plainly (`offline` = keep-going-silently).
 */
export async function claimHandle(handle: string): Promise<ClaimResult> {
  try {
    const res = await apiFetch("/api/identity/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle }),
    });

    if (res.ok) {
      const body = (await res.json()) as { handle: string; recoveryCode: string };
      writeStoredHandle(body.handle);
      return { ok: true, handle: body.handle, recoveryCode: body.recoveryCode };
    }
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, reason: body.error === "ALREADY_CLAIMED" ? "already_claimed" : "taken" };
    }
    if (res.status === 400) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "offline" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

export type AdoptResult =
  | { readonly ok: true; readonly handle: string }
  | { readonly ok: false; readonly reason: "invalid" | "offline" };

/**
 * Re-links this session to an existing identity by its recovery code
 * (cross-device restore). Never throws; a wrong/unknown code is `invalid`, any
 * connectivity failure is `offline`.
 */
export async function adoptIdentity(recoveryCode: string): Promise<AdoptResult> {
  try {
    const res = await apiFetch("/api/identity/adopt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recoveryCode }),
    });

    if (res.ok) {
      const body = (await res.json()) as { handle: string };
      writeStoredHandle(body.handle);
      return { ok: true, handle: body.handle };
    }
    if (res.status === 400) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "offline" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

// ---------------------------------------------------------------------------
// Value-moment signal (MPG-091-c trigger)
// ---------------------------------------------------------------------------

/**
 * A "worth keeping" moment just happened — a leaderboard-worthy score or a win
 * (the trigger threshold chosen for MPG-091-c). Emitted fire-and-forget from the
 * value moments themselves; the claim gate (`useClaimGate`) decides whether to
 * actually offer the prompt (only when unclaimed, backend reachable, and not
 * already offered/dismissed this session). Mirrors `onUsernameCollision`'s
 * decoupled listener pattern so the game screens stay identity-agnostic.
 */
type ValueMomentListener = () => void;
const valueMomentListeners = new Set<ValueMomentListener>();

export function onValueMoment(listener: ValueMomentListener): () => void {
  valueMomentListeners.add(listener);
  return () => {
    valueMomentListeners.delete(listener);
  };
}

export function noteValueMoment(): void {
  valueMomentListeners.forEach((listener) => listener());
}
