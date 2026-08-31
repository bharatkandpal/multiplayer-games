/**
 * Creator-only watch-rejoin storage (MPG-025).
 *
 * An all-bot "watch" room gives its creator no seat, so no `sessionToken` to
 * reconnect with (unlike every other online room). The server instead hands
 * back an opaque `creatorToken` on `room:create` (docs/API_SPEC.md §2/§3.0)
 * that lets this tab's socket re-join the room's broadcast channel later via
 * `room:state({ roomId, creatorToken })` — the only supported way to
 * "watch-rejoin" after e.g. a page refresh.
 *
 * Stored in `sessionStorage` (not `localStorage`, same reasoning as
 * `./session.ts` uses `localStorage` for the opposite reason): this is a
 * "this tab is watching this room" relationship, not an identity meant to
 * outlive the tab or be shared with anyone else — that's the separate,
 * not-yet-built MPG-027 public spectator link, not this.
 */

const PREFIX = "mpg_creator_token:";

function keyFor(roomId: string): string {
  return `${PREFIX}${roomId}`;
}

/** Remembers `roomId`'s creator credential so this tab can watch-rejoin after a reload. */
export function storeCreatorToken(roomId: string, creatorToken: string): void {
  try {
    window.sessionStorage.setItem(keyFor(roomId), creatorToken);
  } catch {
    // sessionStorage can throw (privacy mode, disabled storage, …) — the
    // watch flow still works for the remainder of this page load, just not
    // across a reload.
  }
}

/** Synchronously reads back a previously-stored creator credential, if any. */
export function getStoredCreatorToken(roomId: string): string | undefined {
  try {
    return window.sessionStorage.getItem(keyFor(roomId)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Forgets `roomId`'s creator credential (e.g. once the watcher leaves for good). */
export function clearCreatorToken(roomId: string): void {
  try {
    window.sessionStorage.removeItem(keyFor(roomId));
  } catch {
    // Best-effort only.
  }
}
