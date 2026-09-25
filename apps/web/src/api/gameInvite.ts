/**
 * Room id / secret generation and invite-URL encoding for peer-to-peer online
 * play. There's no chat equivalent to mirror here: chat's private-room secret
 * is always typed by hand into a lock-screen gate (`./chatSecret.ts`,
 * `ChatScreen`'s `SecretGate`) and deliberately never rides in the URL. An
 * online-play invite link has no such gate — `JoinScreen` joins straight away
 * (no secret prompt, same UX as before this feature existed) — so the secret
 * has to travel in the link itself for a friend's tap to work at all. It rides
 * the URL *fragment* (`#s=...`), not the query string, so it's never sent to
 * any server in a request line or appear in referrer headers — the fragment
 * never leaves the browser except by the user copying the whole URL.
 */

const ROOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Random, URL-safe hex — used for both room ids and secrets (distinct calls, distinct values). */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh room id, guaranteed to match the server's `/^[a-zA-Z0-9_-]{1,64}$/`. */
export function createRoomId(): string {
  const id = `r-${randomHex(8)}`;
  // Always true by construction, but keep the invariant explicit and checked
  // rather than assumed — a room id that the token route would reject must
  // never be silently handed out.
  return ROOM_ID_RE.test(id) ? id : `r${Date.now().toString(36)}`;
}

/** A fresh, opaque per-room secret. Never derived from anything guessable. */
export function createRoomSecret(): string {
  return randomHex(16);
}

/** Builds the full, shareable invite URL, carrying the secret in the fragment. */
export function buildGameInviteUrl(gameId: string, roomId: string, secret: string): string {
  const path = `/${gameId}/room/${roomId}`;
  const hash = `#s=${encodeURIComponent(secret)}`;
  if (typeof window === "undefined") return `${path}${hash}`;
  return `${window.location.origin}${path}${hash}`;
}

/** Reads the `#s=<secret>` fragment off a location hash (e.g. `window.location.hash`). */
export function parseInviteSecret(hash: string): string | undefined {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  const secret = params.get("s");
  return secret && secret.length > 0 ? secret : undefined;
}
