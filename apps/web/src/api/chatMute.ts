/**
 * Local mute-by-token (CHAT-007) — a purely client-side, per-browser filter.
 *
 * Muting keys off the sender's session **token**, not their display name:
 * names are self-chosen and can collide or be re-picked, but a token is the
 * one stable thing that actually identifies "this browser/sender" across
 * messages. Persisted to localStorage so a mute survives a reload; entirely
 * local, no network call and nothing sent to the server — a muted sender
 * still reaches everyone else.
 */

const STORAGE_KEY = "mpg_chat_muted_tokens";

function readMuted(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    // Malformed JSON or storage unavailable (privacy mode, disabled storage, …).
    return new Set();
  }
}

function writeMuted(tokens: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...tokens]));
  } catch {
    // Best-effort persistence only; the mute still works for this render.
  }
  notifyMuteChange();
}

type MuteChangeListener = () => void;
const muteChangeListeners = new Set<MuteChangeListener>();

/** Subscribe to be told whenever the muted set changes. Returns an unsubscribe function. */
export function onMuteChange(listener: MuteChangeListener): () => void {
  muteChangeListeners.add(listener);
  return () => {
    muteChangeListeners.delete(listener);
  };
}

function notifyMuteChange(): void {
  muteChangeListeners.forEach((listener) => listener());
}

/** Synchronously reads the current muted-token set. No network. */
export function getMutedTokens(): Set<string> {
  return readMuted();
}

export function isTokenMuted(token: string): boolean {
  return readMuted().has(token);
}

export function muteToken(token: string): void {
  const muted = readMuted();
  if (muted.has(token)) return;
  muted.add(token);
  writeMuted(muted);
}

export function unmuteToken(token: string): void {
  const muted = readMuted();
  if (!muted.has(token)) return;
  muted.delete(token);
  writeMuted(muted);
}
