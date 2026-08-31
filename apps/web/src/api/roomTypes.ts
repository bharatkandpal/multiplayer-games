/**
 * Wire-safe room/seat shapes shared between the room client (`useRoom`) and
 * the screens that render them (`InviteScreen`, `JoinScreen`). Mirrors the
 * server's `PublicRoom`/`PublicSeat` (apps/server/src/rooms/types.ts) —
 * kept as a plain, hand-written copy rather than a cross-package import
 * since the web app doesn't depend on `@mpg/server` (docs/API_SPEC.md is
 * the source of truth for the shape; if it drifts, update both sides).
 */

import type { Difficulty, GameId } from "@mpg/engine";

export type Slot = number;
export type RoomStatus = "waiting" | "active" | "finished" | "abandoned";

export interface PublicSeat {
  slot: Slot;
  kind: "human" | "bot";
  difficulty?: Difficulty | undefined;
  displayName?: string | undefined;
  team?: number | undefined;
  open: boolean;
  connected: boolean;
}

export interface PublicRoom {
  roomId: string;
  gameId: GameId;
  status: RoomStatus;
  turn: Slot;
  state: unknown;
  seats: PublicSeat[];
}

export interface RoomErrorPayload {
  code: string;
  message: string;
}

/** A seat declaration used when creating a room — see server `SeatConfig`. */
export type SeatConfigInput =
  | { slot: Slot; kind: "human"; self?: boolean; displayName?: string }
  | { slot: Slot; kind: "bot"; difficulty: Difficulty };
