/**
 * `useChatRooms` (CHAT-022) — the lobby's room list.
 *
 * Rooms are administrator-owned, so this is read-only: it polls
 * `GET /api/chat/rooms` and exposes what came back. There is no create, join,
 * or mutate counterpart anywhere in the client.
 *
 * Degradation is the whole design here (CLAUDE.md offline rule,
 * docs/CHAT_UI.md §6.5): a failure yields `rooms: null`, which the rail renders
 * as *nothing at all* — no error row, no retry button, no spinner that outlives
 * its request. A direct room link still works with the list absent, so losing
 * it costs discoverability and nothing else.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchChatRooms, type ChatRoomSummary } from "../api/chat.js";

/** How often the list refreshes. Counts are a hint, not a live readout. */
const POLL_MS = 30_000;

export interface UseChatRoomsResult {
  /** The rooms, or `null` while loading and whenever the list is unavailable. */
  rooms: ChatRoomSummary[] | null;
  /** True only during the very first load — used to show skeleton rows once. */
  loading: boolean;
}

export function useChatRooms(): UseChatRoomsResult {
  const [rooms, setRooms] = useState<ChatRoomSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    const next = await fetchChatRooms();
    if (cancelledRef.current) return;
    // A failed refresh keeps the rooms already on screen rather than blanking
    // the rail: a stale list is more useful than no list, and the counts were
    // never promised to be live.
    if (next !== null) setRooms(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void load();

    const timer = setInterval(() => void load(), POLL_MS);
    // Refresh when the tab comes back, so someone returning to a backgrounded
    // lobby doesn't read counts from ten minutes ago.
    const onFocus = (): void => void load();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelledRef.current = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  return { rooms, loading };
}
