// Room / Seat data model — see docs/TDD.md §4.3 & §5, docs/API_SPEC.md §1.
//
// Rooms are ephemeral: kept in-memory (or, later, Redis — MPG-067), never in the
// durable Postgres store (that store is for results/leaderboard/sessions, MPG-053).

import type { Difficulty, GameId } from "@mpg/engine";

/** 1-based seat position, matching the engine's `Player` turn-order index. */
export type Slot = number;

export type RoomStatus = "waiting" | "active" | "finished" | "abandoned";

/**
 * Declares a seat's intended occupant when creating a room. A human seat is either
 * `self` (the creator, filled immediately) or open (joinable via room ID / invite link).
 * A bot seat always carries its `difficulty`.
 */
export type SeatConfig =
  | { slot: Slot; kind: "human"; self?: boolean; displayName?: string }
  | { slot: Slot; kind: "bot"; difficulty: Difficulty };

/** A room's live seat state — the authoritative, server-only shape. */
export interface Seat {
  slot: Slot;
  kind: "human" | "bot";
  /** Bot seats only. */
  difficulty?: Difficulty | undefined;
  /** Human seats only — identifies the occupant across reconnects/socket churn. */
  sessionToken?: string | undefined;
  /** Human seats only — the currently-attached socket, if connected. */
  socketId?: string | undefined;
  displayName?: string | undefined;
  /** Team modes (2v2 etc.); undefined = free-for-all. */
  team?: number | undefined;
  /** Human seats: true while a socket is attached. Bot seats: always true. */
  connected: boolean;
}

/**
 * A single applied move, appended to the room's server-side move log (MPG-013).
 * Never sent to clients incrementally — used for `game:over` persistence/replay.
 */
export interface MoveLogEntry {
  slot: Slot;
  move: unknown;
  timestamp: number;
}

/**
 * Tracks in-progress rematch negotiation for a `finished` room (MPG-015).
 * `proposedBy` holds the slots of every human seat that has proposed so far;
 * once it covers every occupied human seat, a fresh room is created and its ID
 * recorded here so a late/duplicate `rematch:propose` doesn't spawn a second one.
 */
export interface RematchState {
  proposedBy: Set<Slot>;
  newRoomId?: string;
}

/** The server-side, authoritative room record. Never sent to clients as-is. */
export interface Room {
  id: string;
  gameId: GameId;
  seats: Seat[];
  status: RoomStatus;
  turn: Slot;
  /** Opaque engine state (board), erased here — the room manager doesn't need its shape. */
  state: unknown;
  /** Every applied move this run, oldest first. Used for the game-result move log. */
  moveLog: MoveLogEntry[];
  /** Idempotency key for game-result persistence — stable for this room's game run. */
  runId: string;
  pacingMs?: number;
  createdAt: number;
  expiresAt: number;
  /** Only ever set once `status` is `finished`; cleared implicitly when the room expires. */
  rematchState?: RematchState | undefined;
  /**
   * Opaque credential identifying whichever socket/request called `createRoom`.
   * Never sent in `PublicRoom`. Lets the creator watch-rejoin an all-bot room's
   * Socket.IO broadcasts (via `room:state`) even though there's no seat to bind a
   * `sessionToken` to (MPG-025) — see `RoomManager.isCreatorToken`.
   */
  creatorToken: string;
}

/** Wire-safe seat projection — no session tokens or socket IDs leak to clients. */
export interface PublicSeat {
  slot: Slot;
  kind: "human" | "bot";
  difficulty?: Difficulty | undefined;
  displayName?: string | undefined;
  team?: number | undefined;
  /** True while a human seat is still awaiting a join. */
  open: boolean;
  connected: boolean;
}

/** Wire-safe room projection sent to clients (`PublicRoom` in docs/API_SPEC.md). */
export interface PublicRoom {
  roomId: string;
  gameId: GameId;
  status: RoomStatus;
  turn: Slot;
  state: unknown;
  seats: PublicSeat[];
}
