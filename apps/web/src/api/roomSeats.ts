/**
 * Glue between the server's room/seat model (`roomTypes.ts`) and the client's
 * local seat model (`../game/seatConfig.ts`) used by `GamePlayScreen`.
 *
 * MPG-012 scope is the room lifecycle (create → invite → join → slot
 * assignment) only — once a room fills, play currently hands off to the same
 * local, engine-driven `GamePlayScreen` every seat already uses (no move
 * relay over the socket yet; that's a follow-up ticket). This module is the
 * seam where that hand-off happens, so wiring in real move sync later only
 * touches this file plus `GamePlayScreen`'s move source.
 */

import type { SeatsConfig } from "../game";
import type { PublicRoom, SeatConfigInput } from "./roomTypes.js";

/**
 * Seats for creating an online room: seat 1 is the creator (`self: true`),
 * every other seat is an open human seat, joinable via the invite link.
 * Generalizes to any `playerCount`, not just 1v1.
 */
export function onlineHumanSeats(playerCount: number): SeatConfigInput[] {
  return Array.from({ length: playerCount }, (_, i) =>
    i === 0 ? { slot: i + 1, kind: "human", self: true } : { slot: i + 1, kind: "human" },
  );
}

/**
 * MPG-025: converts the Setup screen's real per-seat editor state
 * (`SeatsConfig` — human/bot + difficulty, any combination) into the room's
 * `SeatConfigInput[]` for `room:create`/`POST /api/rooms`, instead of always
 * assuming every seat is an open human (`onlineHumanSeats` above). The first
 * `human` seat, if any, is marked `self: true` — that's this browser's own
 * seat; every other human seat is left open for the invite link. A config
 * with no human seat at all (every seat `bot`) creates an all-bot "watch"
 * room — the server starts it `active` immediately, no open seats to invite
 * anyone into.
 */
export function toSeatConfigInput(seats: SeatsConfig): SeatConfigInput[] {
  const selfIndex = seats.findIndex((seat) => seat.kind === "human");
  return seats.map((seat, i) =>
    seat.kind === "bot"
      ? { slot: i + 1, kind: "bot", difficulty: seat.difficulty }
      : { slot: i + 1, kind: "human", self: i === selfIndex },
  );
}

/** True when a room's seats are every one a bot — no human seat at all, i.e.
 * an MPG-025 "watch" room rather than a normal online game. */
export function isAllBotRoom(room: PublicRoom): boolean {
  return room.seats.every((seat) => seat.kind === "bot");
}

/** Projects a server `PublicRoom` down to the client's local `SeatsConfig` shape. */
export function publicRoomToSeats(room: PublicRoom): SeatsConfig {
  return room.seats
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((seat) =>
      seat.kind === "bot"
        ? { kind: "bot", difficulty: seat.difficulty ?? "medium" }
        : { kind: "human" },
    );
}
