/**
 * Local mute-by-token (CHAT-007) — a purely client-side, per-browser filter.
 *
 * Muting keys off the sender's session **token**, not their display name:
 * names are self-chosen and can collide or be re-picked, but a token is the
 * one stable thing that actually identifies "this browser/sender" across
 * messages. Persisted to localStorage so a mute survives a reload; entirely
 * local, no network call and nothing sent to the server — a muted sender
 * still reaches everyone else.
 *
 * Stored as token → last-known display name, not just a set of tokens: once a
 * sender is muted their messages stop rendering, so a name has to be kept
 * *at mute time* to show a "who did I mute?" list a reader can undo from
 * (there is otherwise no way to see, let alone reverse, an accidental mute).
 */

const STORAGE_KEY = "mpg_chat_muted_tokens";

function readMuted(): Map<string, string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    return new Map(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    // Malformed JSON or storage unavailable (privacy mode, disabled storage, …).
    return new Map();
  }
}

function writeMuted(muted: Map<string, string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(muted)));
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
  return new Set(readMuted().keys());
}

export interface MutedEntry {
  token: string;
  /** Display name as of the moment they were muted — may be stale if they've since renamed. */
  name: string;
}

/** The muted list for a "who's muted, and undo" surface — name included so it's legible. */
export function getMutedEntries(): MutedEntry[] {
  return [...readMuted()].map(([token, name]) => ({ token, name }));
}

export function isTokenMuted(token: string): boolean {
  return readMuted().has(token);
}

export function muteToken(token: string, name: string = token): void {
  const muted = readMuted();
  if (muted.has(token)) return;
  muted.set(token, name);
  writeMuted(muted);
}

export function unmuteToken(token: string): void {
  const muted = readMuted();
  if (!muted.has(token)) return;
  muted.delete(token);
  writeMuted(muted);
}

/** Clears every mute in one step — the reset the accidental-mute case needs. */
export function unmuteAll(): void {
  if (readMuted().size === 0) return;
  writeMuted(new Map());
}
