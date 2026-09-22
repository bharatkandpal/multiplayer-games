/**
 * Per-room private-chat secret store (CHAT-020).
 *
 * A private room's secret never travels in the URL (that would defeat the point
 * of a secret you share out-of-band), so once a user enters it we hold it for
 * the tab in `sessionStorage`, keyed by room id. That means a reload keeps you
 * in the room without re-typing the secret, but closing the tab forgets it —
 * appropriate for something ephemeral and sensitive.
 *
 * Everything here is best-effort and never throws: `sessionStorage` can be
 * absent (SSR/tests) or blocked (private-mode quotas), and chat is an
 * enhancement that must never break the page (CLAUDE.md offline pillar). A
 * missing store simply means the secret lives in React state for the session.
 */

const KEY_PREFIX = "chat.secret.";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** The secret last entered for `roomId` this tab, or `null` if none is held. */
export function getRoomSecret(roomId: string): string | null {
  try {
    return storage()?.getItem(KEY_PREFIX + roomId) ?? null;
  } catch {
    return null;
  }
}

/** Remembers `secret` for `roomId` for the rest of the tab session. */
export function setRoomSecret(roomId: string, secret: string): void {
  try {
    storage()?.setItem(KEY_PREFIX + roomId, secret);
  } catch {
    // No persistence available — the caller keeps the secret in memory anyway.
  }
}

/** Forgets any stored secret for `roomId` (e.g. leaving a private room). */
export function clearRoomSecret(roomId: string): void {
  try {
    storage()?.removeItem(KEY_PREFIX + roomId);
  } catch {
    // Nothing to clean up if the store is unavailable.
  }
}
