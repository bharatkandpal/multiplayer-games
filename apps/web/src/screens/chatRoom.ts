/**
 * Room identity helpers for chat (CHAT-019).
 *
 * A chat "room" is just a slug in the URL (`/chat/:roomId`); the server mints a
 * token for any id matching the same `[a-zA-Z0-9_-]{1,64}` shape it uses for
 * game rooms. These pure helpers turn a human-typed room name into that slug,
 * and a room id back into a label / path / shareable URL — kept out of the
 * component so the rules are unit-testable on their own.
 */

/**
 * The room a bare `/chat` link opens.
 *
 * Mirrors the server's seeded default (`apps/server/src/chat/defaultRooms.ts`).
 * Renamed from `lobby` when rooms became an administrator-owned registry
 * (CHAT-022); `lobby` still resolves server-side, so links shared before the
 * rename keep working.
 */
export const DEFAULT_CHAT_ROOM_ID = "global";

/** The safe-slug shape a room id must match (mirrors the server's ROOM_ID_RE). */
const ROOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_RE.test(roomId);
}

/**
 * Turns a free-typed room name ("Team Standup!") into a valid room id
 * ("team-standup"), or `null` when nothing usable survives (e.g. "!!!"). The
 * result always satisfies {@link isValidRoomId}.
 */
export function slugifyRoomName(input: string): string | null {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-") // spaces & punctuation collapse to a hyphen
    .replace(/-+/g, "-") // no runs of hyphens
    .replace(/^-+|-+$/g, "") // no leading/trailing hyphens
    .slice(0, 64)
    .replace(/-+$/g, ""); // slicing can re-expose a trailing hyphen
  return slug.length > 0 ? slug : null;
}

/**
 * Human label for a room id. The registry carries a real `label` per room
 * (CHAT-022) — prefer that wherever the room list is loaded; this is the
 * fallback for a room reached by direct link before the list arrives.
 */
export function roomLabel(roomId: string): string {
  return roomId === DEFAULT_CHAT_ROOM_ID ? "Global" : roomId;
}

/**
 * The query flag that marks a link as opening a *private* room (CHAT-020). It
 * is only a hint — it tells the opener's client to prompt for the secret rather
 * than joining a public room of the same name. It is never the secret itself
 * (that is shared out-of-band); security is the secret, not this marker.
 */
export const PRIVATE_ROOM_QUERY = "p";

/** True when a URL search string carries the private-room marker (`?p=1`). */
export function isPrivateRoomSearch(search: string): boolean {
  return new URLSearchParams(search).get(PRIVATE_ROOM_QUERY) === "1";
}

interface RoomLinkOptions {
  /** Mark the link private, so opening it prompts for the room secret. */
  readonly private?: boolean;
}

/** The in-app path for a room — the lobby is the bare `/chat`. */
export function roomPath(roomId: string, opts: RoomLinkOptions = {}): string {
  const base = roomId === DEFAULT_CHAT_ROOM_ID ? "/chat" : `/chat/${encodeURIComponent(roomId)}`;
  return opts.private ? `${base}?${PRIVATE_ROOM_QUERY}=1` : base;
}

/** The absolute, shareable URL for a room, given an origin (e.g. `location.origin`). */
export function roomShareUrl(roomId: string, origin: string, opts: RoomLinkOptions = {}): string {
  return `${origin}${roomPath(roomId, opts)}`;
}
