/**
 * The rooms every deployment starts with (CHAT-022).
 *
 * Rooms are administrator-owned — there is no create endpoint — so this seed is
 * the entire room set until someone edits the database. It exists in two
 * places that must agree: the Postgres migration seeds these rows, and the
 * in-memory store (dev + Vitest) returns them directly, so chat behaves the
 * same with or without a database.
 *
 * The private room's secret is a placeholder meant to be rotated in the
 * database (`UPDATE chat_rooms SET secret = '…' WHERE id = 'pvt'`). It is a
 * shared room code, not a credential: see db/schema.ts `chatRooms` for why it
 * is stored in the clear and the three rules that come with that.
 */

import type { ChatRoom } from "../store/ports.js";

/** The room a bare `/chat` link opens. Mirrors the web app's DEFAULT_CHAT_ROOM_ID. */
export const DEFAULT_CHAT_ROOM_ID = "global";

/**
 * The pre-registry default room id. `/chat/lobby` links were shared before the
 * room set became a closed registry, so the id resolves to {@link
 * DEFAULT_CHAT_ROOM_ID} instead of 404-ing.
 */
export const LEGACY_DEFAULT_CHAT_ROOM_ID = "lobby";

export const DEFAULT_CHAT_ROOMS: readonly ChatRoom[] = [
  { id: DEFAULT_CHAT_ROOM_ID, label: "Global", visibility: "public", secret: null, sortOrder: 0 },
  { id: "pvt", label: "Private", visibility: "private", secret: "1234", sortOrder: 1 },
];
