import { asc, eq } from "drizzle-orm";

import { LEGACY_DEFAULT_CHAT_ROOM_ID } from "../../chat/defaultRooms.js";
import type { Database } from "../../db/drizzle.js";
import { chatRooms } from "../../db/schema.js";
import type { ChatRoom, ChatRoomRepo, ChatRoomVisibility } from "../ports.js";

function toRoom(row: typeof chatRooms.$inferSelect): ChatRoom {
  return {
    id: row.id,
    label: row.label,
    // `visibility` is a text column so a new tier needs no migration; anything
    // that isn't "private" is treated as public — an unknown value must never
    // accidentally unlock a room.
    visibility: (row.visibility === "private" ? "private" : "public") satisfies ChatRoomVisibility,
    secret: row.secret,
    sortOrder: row.sortOrder,
  };
}

export function createPgChatRoomRepo(db: Database): ChatRoomRepo {
  return {
    async list() {
      const rows = await db
        .select()
        .from(chatRooms)
        .orderBy(asc(chatRooms.sortOrder), asc(chatRooms.id));
      return rows.map(toRoom);
    },

    async get(roomId) {
      const rows = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId)).limit(1);
      const row = rows[0];
      if (row) return toRoom(row);

      // `lobby` predates the registry and still appears in already-shared links,
      // so it falls through to the first room rather than 404-ing. Resolved by
      // order (not by a hardcoded id) so it follows whatever the admin has put
      // first, and only when no room literally named "lobby" exists.
      if (roomId !== LEGACY_DEFAULT_CHAT_ROOM_ID) return null;
      const fallback = await db
        .select()
        .from(chatRooms)
        .orderBy(asc(chatRooms.sortOrder), asc(chatRooms.id))
        .limit(1);
      return fallback[0] ? toRoom(fallback[0]) : null;
    },
  };
}
