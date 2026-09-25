/**
 * Per-room localStorage persistence for peer-to-peer online play.
 *
 * There is no server copy of game state at all in the peer-to-peer model
 * (see `useOnlineGame.ts`) — each browser is the only place its own progress
 * lives, so a reload (or a flaky connection that drops and comes back) needs
 * somewhere durable to recover from. We store the room's identity plus its
 * move log (not a derived state blob — see below) keyed by `roomId`, mirroring
 * `./session.ts`'s house style: every access wrapped in try/catch (localStorage
 * can throw in private-browsing/disabled-storage), a single prefixed key
 * scheme, narrow get/set/remove helpers that never throw. Same idea as
 * `./watchSession.ts`'s `PREFIX + roomId` keying, `localStorage` here (not
 * `sessionStorage`) because this is meant to survive exactly the reload a
 * `sessionStorage`-backed store wouldn't help with.
 *
 * The move log, not a state snapshot, is what's persisted: a stored state
 * blob would have to be trusted as-is on reload, which is exactly the kind of
 * unverified authority this feature avoids even over the wire (`useOnlineGame`
 * always replays a peer's log through the engine rather than trusting a raw
 * state). Rehydrating locally-authored history the same way keeps ONE trust
 * boundary (`GameModule.applyMove`) for state, whether it came from disk, from
 * the peer, or from this tab's own last session.
 */

/** One applied move, as persisted — `player` is the engine's 1-based `Player`. */
export interface StoredMove {
  readonly move: unknown;
  readonly player: number;
}

export interface StoredGameRoom {
  readonly roomId: string;
  readonly secret: string;
  readonly gameId: string;
  /** This browser's own seat for this room (1 = creator, 2 = joiner). */
  readonly mySlot: number;
  /** Every move applied to this room so far, oldest first. */
  readonly moveLog: readonly StoredMove[];
}

const PREFIX = "mpg_online_room:";

function keyFor(roomId: string): string {
  return `${PREFIX}${roomId}`;
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Persists (overwriting) the full record for `room.roomId`. Best-effort; never throws. */
export function saveGameRoom(room: StoredGameRoom): void {
  try {
    storage()?.setItem(keyFor(room.roomId), JSON.stringify(room));
  } catch {
    // No persistence available (or quota exceeded) — the game still plays
    // fine for the rest of this tab session, it just can't resume a reload.
  }
}

/**
 * Reads back a previously-stored room, if any and if it parses as one.
 * Malformed/foreign JSON (a corrupt write, a future format) degrades to
 * "nothing stored" rather than throwing — a rehydrate failure should start a
 * fresh session, never break the page.
 */
export function loadGameRoom(roomId: string): StoredGameRoom | undefined {
  try {
    const raw = storage()?.getItem(keyFor(roomId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredGameRoom> | null;
    if (
      !parsed ||
      typeof parsed.roomId !== "string" ||
      typeof parsed.secret !== "string" ||
      typeof parsed.gameId !== "string" ||
      typeof parsed.mySlot !== "number" ||
      !Array.isArray(parsed.moveLog)
    ) {
      return undefined;
    }
    return parsed as StoredGameRoom;
  } catch {
    return undefined;
  }
}

/** Forgets `roomId`'s stored room (e.g. the player left/exited for good). */
export function clearGameRoom(roomId: string): void {
  try {
    storage()?.removeItem(keyFor(roomId));
  } catch {
    // Nothing to clean up if the store is unavailable.
  }
}
