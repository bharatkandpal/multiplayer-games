/**
 * Client-side username storage + best-effort server sync (MPG-077).
 *
 * Deliberately **local-first and loosely coupled** to the backend: picking a
 * name never blocks on the network. `setStoredUsername` is a synchronous
 * localStorage write (same pattern as `./session.ts`); the server round-trip
 * (`syncUsername`) is fire-and-forget and only exists to (a) confirm global
 * uniqueness when the backend happens to be reachable and (b) surface a
 * genuine, server-confirmed collision so the UI can ask for a different name.
 * Any other outcome — network error, timeout, 5xx, backend not running at
 * all — is swallowed silently; the locally-picked name keeps working for
 * this browser regardless.
 */

import { apiFetch } from "./session.js";

const STORAGE_KEY = "mpg_username";

interface StoredUsername {
  name: string;
  /** True once the server has confirmed this name is (still) uniquely ours. */
  confirmed: boolean;
}

function readStored(): StoredUsername | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredUsername> | null;
    if (!parsed || typeof parsed.name !== "string" || parsed.name.length === 0) return null;
    return { name: parsed.name, confirmed: parsed.confirmed === true };
  } catch {
    // Malformed JSON or storage unavailable (privacy mode, disabled storage, …).
    return null;
  }
}

function writeStored(value: StoredUsername): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best-effort persistence only; the name still works for this tab.
  }
}

/** Synchronously reads the cached username, if any. Does not hit the network. */
export function getStoredUsername(): string | null {
  return readStored()?.name ?? null;
}

/**
 * Local-only write — call this the instant the user submits a name so they
 * can proceed without waiting on the server. `confirmed` defaults to `false`
 * (not yet round-tripped); `syncUsername` flips it to `true` on success.
 */
export function setStoredUsername(name: string, confirmed = false): void {
  writeStored({ name, confirmed });
}

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;

/** Client-side mirror of the server's validation (length 3–20, alphanumeric + `_`/`-`). */
export function isValidUsernameFormat(name: string): boolean {
  return USERNAME_PATTERN.test(name);
}

export type UsernameSyncResult =
  | { ok: true; username: string }
  | { ok: false; reason: "taken" | "invalid" | "offline" };

type CollisionListener = () => void;
const collisionListeners = new Set<CollisionListener>();

/**
 * Subscribe to be told when a background sync (initial or reconciled) finds
 * a genuine, server-confirmed collision on the currently-stored name. This
 * is the only case that should ever prompt the user to pick a different
 * name after the fact — never for a plain network failure. Returns an
 * unsubscribe function.
 */
export function onUsernameCollision(listener: CollisionListener): () => void {
  collisionListeners.add(listener);
  return () => {
    collisionListeners.delete(listener);
  };
}

function notifyCollision(): void {
  collisionListeners.forEach((listener) => listener());
}

/**
 * Fire-and-forget sync with the server. Never throws. Resolves with
 * `{ ok: false, reason: "offline" }` for ANY non-collision, non-validation
 * failure (network error, timeout, 5xx, backend not running) — callers must
 * treat that as "keep going locally", not an error to surface.
 */
export async function syncUsername(name: string): Promise<UsernameSyncResult> {
  try {
    const res = await apiFetch("/api/session/username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name }),
    });

    if (res.ok) {
      const body = (await res.json()) as { username: string };
      writeStored({ name: body.username, confirmed: true });
      return { ok: true, username: body.username };
    }

    if (res.status === 409) {
      notifyCollision();
      return { ok: false, reason: "taken" };
    }

    if (res.status === 400) {
      return { ok: false, reason: "invalid" };
    }

    return { ok: false, reason: "offline" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

/** True if we have a local name that hasn't been confirmed unique by the server yet. */
export function hasUnconfirmedUsername(): boolean {
  const stored = readStored();
  return stored !== null && !stored.confirmed;
}

/**
 * Best-effort reconciliation: if the initial sync never got a definitive
 * answer (offline/backend down at the time), retry silently on the next
 * natural server contact — e.g. `useRoom` creating/joining a room, or app
 * boot. A confirmed success or a still-unreachable server are both silent;
 * only a genuine collision is surfaced, via `onUsernameCollision`. Never
 * throws, never blocks its caller.
 */
export async function reconcileUsername(): Promise<void> {
  const stored = readStored();
  if (!stored || stored.confirmed) return;
  await syncUsername(stored.name);
}
