import { DEFAULT_CHAT_ROOMS, LEGACY_DEFAULT_CHAT_ROOM_ID } from "../../chat/defaultRooms.js";
import type { ChatRoom, ChatRoomRepo } from "../ports.js";

/**
 * In-memory chat room registry (dev + Vitest).
 *
 * Seeded with the same rooms the Postgres migration inserts, so a developer
 * with no DATABASE_URL gets an identical room set — chat is an enhancement and
 * must not need a database to work (CLAUDE.md offline rule).
 *
 * Read-only, like the port: rooms are administrator-owned, so there is nothing
 * here to write through.
 */
export function createMemoryChatRoomRepo(
  seed: readonly ChatRoom[] = DEFAULT_CHAT_ROOMS,
): ChatRoomRepo {
  const rooms = [...seed].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const defaultRoom = rooms[0];

  return {
    async list() {
      return rooms.map((r) => ({ ...r }));
    },

    async get(roomId) {
      // `lobby` predates the registry and still appears in shared links — it
      // resolves to the default room rather than 404-ing.
      const id = roomId === LEGACY_DEFAULT_CHAT_ROOM_ID ? (defaultRoom?.id ?? roomId) : roomId;
      const found = rooms.find((r) => r.id === id);
      return found ? { ...found } : null;
    },
  };
}
