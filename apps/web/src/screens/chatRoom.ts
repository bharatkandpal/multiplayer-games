/**
 * Room identity helpers for chat (CHAT-019).
 *
 * A chat "room" is just a slug in the URL (`/chat/:roomId`); the server mints a
 * token for any id matching the same `[a-zA-Z0-9_-]{1,64}` shape it uses for
 * game rooms. These pure helpers turn a human-typed room name into that slug,
 * and a room id back into a label / path / shareable URL — kept out of the
 * component so the rules are unit-testable on their own.
 */

/** The room a bare `/chat` link opens — the shared, un-scoped lobby. */
export const DEFAULT_CHAT_ROOM_ID = "lobby";

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

/** Human label for a room id — the lobby gets a friendly name, others show as-is. */
export function roomLabel(roomId: string): string {
  return roomId === DEFAULT_CHAT_ROOM_ID ? "Lobby" : roomId;
}

/** The in-app path for a room — the lobby is the bare `/chat`. */
export function roomPath(roomId: string): string {
  return roomId === DEFAULT_CHAT_ROOM_ID ? "/chat" : `/chat/${encodeURIComponent(roomId)}`;
}

/** The absolute, shareable URL for a room, given an origin (e.g. `location.origin`). */
export function roomShareUrl(roomId: string, origin: string): string {
  return `${origin}${roomPath(roomId)}`;
}
