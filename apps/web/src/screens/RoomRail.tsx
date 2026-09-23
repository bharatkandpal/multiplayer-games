/**
 * The chat lobby rail (CHAT-022) — the room list, its public/private filter,
 * and the current-room highlight.
 *
 * Rooms are administrator-owned, so this lists and nothing else: no create
 * control, no join-by-name field. The set it shows is the complete set of
 * rooms (docs/CHAT_UI.md §6.1).
 *
 * It degrades to absence: with no list it renders nothing at all rather than an
 * error or a retry, because a direct room link still reaches every room.
 */

import { useState } from "react";
import type { ChatRoomSummary } from "../api/chat.js";
import styles from "./RoomRail.module.css";

type Filter = "all" | "public" | "private";

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "public", label: "Public" },
  { id: "private", label: "Private" },
];

export interface RoomRailProps {
  rooms: ChatRoomSummary[] | null;
  loading: boolean;
  currentRoomId: string;
  /** Navigate to a room. The parent decides whether that needs the secret gate. */
  onSelect: (room: ChatRoomSummary) => void;
}

export function RoomRail({
  rooms,
  loading,
  currentRoomId,
  onSelect,
}: RoomRailProps): React.JSX.Element | null {
  const [filter, setFilter] = useState<Filter>("all");

  if (loading) {
    return (
      <nav className={styles.rail} aria-label="Chat rooms">
        <ul className={styles.skeletonList} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className={styles.skeletonRow} />
          ))}
        </ul>
      </nav>
    );
  }

  // Degrade to absence — no list, no rail. Never an error row.
  if (!rooms || rooms.length === 0) return null;

  const visible = rooms.filter((r) => filter === "all" || r.visibility === filter);

  return (
    <nav className={styles.rail} aria-label="Chat rooms">
      {/* The filter earns its keep as the admin adds rooms; with two seeded
          rooms it is near-pointless, so it is hidden until there are enough
          rooms for it to mean anything. */}
      {rooms.length > 3 && (
        <div className={styles.filters} role="tablist" aria-label="Filter rooms">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? `${styles.filter} ${styles.filterOn}` : styles.filter}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <ul className={styles.rooms}>
        {visible.map((room) => {
          const current = room.id === currentRoomId;
          return (
            <li key={room.id}>
              <button
                type="button"
                className={current ? `${styles.room} ${styles.roomOn}` : styles.room}
                {...(current ? { "aria-current": "true" as const } : {})}
                onClick={() => onSelect(room)}
              >
                <span className={styles.roomMark} aria-hidden="true">
                  {room.visibility === "private" ? "🔒" : "#"}
                </span>
                <span className={styles.roomLabel}>{room.label}</span>
                {/* An absent count renders as nothing — occupancy was
                    unavailable, and a "0" would claim the room is empty. */}
                {room.active !== undefined && (
                  <span className={styles.roomCount}>
                    <span aria-hidden="true">{room.active}</span>
                    <span className={styles.srOnly}>
                      {room.active === 1 ? "1 person here" : `${room.active} people here`}
                    </span>
                  </span>
                )}
                {room.visibility === "private" && <span className={styles.srOnly}>(private)</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
