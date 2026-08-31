// Room Manager — creates/joins/leaves ephemeral rooms and owns their lifecycle
// (TTL expiry, disconnect grace). Rooms live in memory only (Map), never in the
// durable Postgres store — see docs/TDD.md §4.3 & §5.
//
// This module knows nothing about Socket.IO; `roomHandlers.ts` wires it to the
// transport. That keeps the transport swappable (docs/ARCHITECTURE.md).

import { EventEmitter } from "node:events";

import { nanoid } from "nanoid";

import { getGame, hasGame } from "@mpg/engine";
import type { GameId } from "@mpg/engine";

import type { PublicRoom, PublicSeat, Room, Seat, SeatConfig, Slot } from "./types.js";

export type RoomManagerErrorCode =
  | "UNKNOWN_GAME"
  | "INVALID_SEATS"
  | "NOT_FOUND"
  | "EXPIRED"
  | "ROOM_FULL"
  | "SEAT_TAKEN"
  | "SEAT_NOT_FOUND"
  | "NOT_A_MEMBER"
  | "NOT_FINISHED";

export class RoomManagerError extends Error {
  readonly code: RoomManagerErrorCode;

  constructor(code: RoomManagerErrorCode, message: string) {
    super(message);
    this.name = "RoomManagerError";
    this.code = code;
  }
}

export interface RoomManagerOptions {
  /** Room TTL in ms (reset on activity). Default 30 minutes. */
  ttlMs?: number;
  /** How often the expiry sweep runs. Default 60s. */
  sweepIntervalMs?: number;
  /** Grace window for a disconnected human seat to reconnect. Default 30s. */
  reconnectGraceMs?: number;
  /** Pacing delay between auto (bot) moves, for watchability. Default 600ms. */
  pacingMs?: number;
}

interface SocketBinding {
  roomId: string;
  slot: Slot;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;
const DEFAULT_RECONNECT_GRACE_MS = 30 * 1000;
const DEFAULT_PACING_MS = 600;

/**
 * Events emitted (all with the room's authoritative `Room`, or `{ roomId }` on removal):
 *  - "room:updated"    seats/status changed
 *  - "seat:disconnected" { room, slot }
 *  - "seat:reconnected"  { room, slot }
 *  - "room:abandoned"    { room, reason }
 *  - "room:expired"      { roomId }
 *  - "rematch:proposed"  { room, slot }              (MPG-015)
 *  - "rematch:declined"  { room, slot }               (MPG-015)
 *  - "rematch:matched"   { room, newRoom }            (MPG-015; every human seat proposed)
 */
export class RoomManager extends EventEmitter {
  private readonly rooms = new Map<string, Room>();
  private readonly sockets = new Map<string, SocketBinding>();
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  private readonly ttlMs: number;
  private readonly reconnectGraceMs: number;
  private readonly pacingMs: number;
  private sweepHandle: NodeJS.Timeout | undefined;

  constructor(options: RoomManagerOptions = {}) {
    super();
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.reconnectGraceMs = options.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
    this.pacingMs = options.pacingMs ?? DEFAULT_PACING_MS;

    const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.sweepHandle = setInterval(() => this.sweepExpired(), sweepIntervalMs);
    this.sweepHandle.unref?.();
  }

  /** Stop background timers. Call on server shutdown / in test teardown. */
  destroy(): void {
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    for (const timer of this.graceTimers.values()) clearTimeout(timer);
    this.graceTimers.clear();
    this.rooms.clear();
    this.sockets.clear();
  }

  // ---------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------

  /**
   * Mint a room ID ahead of `createRoom`, so a caller that needs the creating
   * socket to already be a Socket.IO room member before `createRoom` fires its
   * synchronous `room:updated` (see below) can `socket.join(roomId)` first.
   */
  reserveRoomId(): string {
    return nanoid(12);
  }

  createRoom(
    gameId: string,
    seatConfig: SeatConfig[],
    opts: { roomId?: string } = {},
  ): { room: Room; sessionTokens: Map<Slot, string>; creatorToken: string } {
    if (!hasGame(gameId as GameId)) {
      throw new RoomManagerError("UNKNOWN_GAME", `Unknown game: ${gameId}`);
    }
    const module = getGame(gameId as GameId);
    this.validateSeatConfig(seatConfig, module.playerCount);

    const seats: Seat[] = [];
    const sessionTokens = new Map<Slot, string>();

    for (const config of [...seatConfig].sort((a, b) => a.slot - b.slot)) {
      if (config.kind === "bot") {
        seats.push({
          slot: config.slot,
          kind: "bot",
          difficulty: config.difficulty,
          connected: true,
        });
        continue;
      }

      // Human seat: `self` is filled immediately by the creator; others start open.
      if (config.self) {
        const sessionToken = nanoid();
        sessionTokens.set(config.slot, sessionToken);
        seats.push({
          slot: config.slot,
          kind: "human",
          sessionToken,
          displayName: config.displayName,
          connected: false, // becomes true once the socket actually joins
        });
      } else {
        seats.push({
          slot: config.slot,
          kind: "human",
          connected: false,
        });
      }
    }

    const now = Date.now();
    const creatorToken = nanoid();
    const room: Room = {
      id: opts.roomId ?? nanoid(12),
      gameId: gameId as Room["gameId"],
      seats,
      status: hasOpenHumanSeat(seats) ? "waiting" : "active",
      turn: 1,
      state: module.createInitialState(),
      moveLog: [],
      runId: nanoid(),
      pacingMs: this.pacingMs,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      creatorToken,
    };

    this.rooms.set(room.id, room);
    this.emit("room:updated", room);
    return { room, sessionTokens, creatorToken };
  }

  // ---------------------------------------------------------------------
  // Join / Leave
  // ---------------------------------------------------------------------

  /**
   * Join a room. If `sessionToken` already occupies a seat (reconnect), rebind it.
   * Otherwise assign the next open human seat (or `seatIndex` if given and open).
   */
  joinRoom(
    roomId: string,
    sessionToken: string,
    opts: {
      seatIndex?: number | undefined;
      displayName?: string | undefined;
      socketId?: string | undefined;
    } = {},
  ): { room: Room; seat: Seat } {
    const room = this.requireRoom(roomId);

    // Reconnect: same session token already owns a seat in this room.
    const existing = room.seats.find((s) => s.kind === "human" && s.sessionToken === sessionToken);
    if (existing) {
      this.clearGraceTimer(roomId, existing.slot);
      const wasDisconnected = !existing.connected;
      existing.connected = true;
      if (opts.socketId) {
        existing.socketId = opts.socketId;
        this.sockets.set(opts.socketId, { roomId, slot: existing.slot });
      }
      this.touch(room);
      this.emit("room:updated", room);
      if (wasDisconnected) this.emit("seat:reconnected", { room, slot: existing.slot });
      return { room, seat: existing };
    }

    const seat = this.findOpenHumanSeat(room, opts.seatIndex);
    if (!seat) {
      throw new RoomManagerError("ROOM_FULL", "No open human seats in this room");
    }

    seat.sessionToken = sessionToken;
    seat.connected = true;
    seat.displayName = opts.displayName ?? seat.displayName;
    if (opts.socketId) {
      seat.socketId = opts.socketId;
      this.sockets.set(opts.socketId, { roomId, slot: seat.slot });
    }

    if (!hasOpenHumanSeat(room.seats)) {
      room.status = "active";
    }
    this.touch(room);
    this.emit("room:updated", room);
    return { room, seat };
  }

  /**
   * Explicit leave (not a disconnect). Frees the seat if the room is still
   * `waiting`; abandons the room outright if it was `active` (a deliberate
   * mid-game leave — unlike a disconnect, there's no reconnect grace to give).
   */
  leaveRoom(roomId: string, sessionToken: string): Room {
    const room = this.requireRoom(roomId);
    const seat = room.seats.find((s) => s.kind === "human" && s.sessionToken === sessionToken);
    if (!seat) {
      throw new RoomManagerError("NOT_A_MEMBER", "That session does not hold a seat in this room");
    }

    this.clearGraceTimer(roomId, seat.slot);
    if (seat.socketId) this.sockets.delete(seat.socketId);

    const wasActive = room.status === "active";

    seat.sessionToken = undefined;
    seat.socketId = undefined;
    seat.connected = false;
    seat.displayName = undefined;

    if (wasActive) {
      // A deliberate mid-game leave abandons the room outright — play can't
      // resume with a stranger in a seat that already had moves made in it.
      room.status = "abandoned";
      this.emit("room:abandoned", { room, reason: "opponent-left" });
    } else if (room.status === "waiting") {
      room.status = hasOpenHumanSeat(room.seats) ? "waiting" : room.status;
    }

    this.touch(room);
    this.emit("room:updated", room);
    return room;
  }

  // ---------------------------------------------------------------------
  // Rematch (MPG-015)
  // ---------------------------------------------------------------------

  /**
   * Record `sessionToken`'s proposal to rematch in a `finished` room. Once every
   * occupied human seat has proposed, mints a fresh room with the same game +
   * seat config (session tokens carried over) and stamps `newRoomId` on the
   * source room's `rematchState` so a late/duplicate proposal is a no-op.
   */
  proposeRematch(
    roomId: string,
    sessionToken: string,
  ): { room: Room; seat: Seat; allProposed: boolean; newRoom: Room | undefined } {
    const room = this.requireRoom(roomId);
    if (room.status !== "finished") {
      throw new RoomManagerError(
        "NOT_FINISHED",
        "Rematch is only available once the game has finished",
      );
    }
    const seat = room.seats.find((s) => s.kind === "human" && s.sessionToken === sessionToken);
    if (!seat) {
      throw new RoomManagerError("NOT_A_MEMBER", "That session does not hold a seat in this room");
    }

    room.rematchState ??= { proposedBy: new Set<Slot>() };
    room.rematchState.proposedBy.add(seat.slot);
    this.touch(room);
    this.emit("rematch:proposed", { room, slot: seat.slot });

    const occupiedHumanSlots = room.seats
      .filter((s) => s.kind === "human" && s.sessionToken !== undefined)
      .map((s) => s.slot);
    const allProposed = occupiedHumanSlots.every((slot) => room.rematchState?.proposedBy.has(slot));

    let newRoom: Room | undefined;
    if (allProposed && !room.rematchState.newRoomId) {
      newRoom = this.createRematchRoom(room);
      room.rematchState.newRoomId = newRoom.id;
      // `createRematchRoom` deliberately does not emit `room:updated` for the
      // new room — see its rematchHandler.ts listener (the ONLY thing that
      // rebinds sockets into `newRoom.id`) for why that broadcast has to wait
      // until every socket has actually joined the new Socket.IO room.
      this.emit("rematch:matched", { room, newRoom });
    }

    return { room, seat, allProposed, newRoom };
  }

  /** Decline a pending rematch — clears any proposals so far, for anyone to re-propose fresh. */
  declineRematch(roomId: string, sessionToken: string): { room: Room; seat: Seat } {
    const room = this.requireRoom(roomId);
    const seat = room.seats.find((s) => s.kind === "human" && s.sessionToken === sessionToken);
    if (!seat) {
      throw new RoomManagerError("NOT_A_MEMBER", "That session does not hold a seat in this room");
    }

    room.rematchState = undefined;
    this.touch(room);
    this.emit("rematch:declined", { room, slot: seat.slot });
    return { room, seat };
  }

  /**
   * A fresh room with `sourceRoom`'s game + seat config (bot difficulties and
   * human session tokens carried over verbatim — same players, same bots), and
   * an all-new engine state/move log/run ID.
   */
  private createRematchRoom(sourceRoom: Room): Room {
    const module = getGame(sourceRoom.gameId);
    const seats: Seat[] = sourceRoom.seats.map((seat) =>
      seat.kind === "bot"
        ? { slot: seat.slot, kind: "bot", difficulty: seat.difficulty, connected: true }
        : {
            slot: seat.slot,
            kind: "human",
            sessionToken: seat.sessionToken,
            displayName: seat.displayName,
            team: seat.team,
            connected: false,
          },
    );

    const now = Date.now();
    const room: Room = {
      id: nanoid(12),
      gameId: sourceRoom.gameId,
      seats,
      status: hasOpenHumanSeat(seats) ? "waiting" : "active",
      turn: 1,
      state: module.createInitialState(),
      moveLog: [],
      runId: nanoid(),
      pacingMs: this.pacingMs,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      creatorToken: nanoid(),
    };

    this.rooms.set(room.id, room);
    // Deliberately no `room:updated` emit here — see the caller (`proposeRematch`)
    // for why that must wait until after sockets have rejoined this room.
    return room;
  }

  // ---------------------------------------------------------------------
  // Socket lifecycle (disconnect grace)
  // ---------------------------------------------------------------------

  /** Called by the transport layer when a socket disconnects. */
  handleSocketDisconnect(socketId: string): void {
    const binding = this.sockets.get(socketId);
    if (!binding) return;
    this.sockets.delete(socketId);

    const room = this.rooms.get(binding.roomId);
    if (!room) return;
    const seat = room.seats.find((s) => s.slot === binding.slot);
    if (!seat || seat.kind !== "human" || seat.socketId !== socketId) return;

    seat.connected = false;
    seat.socketId = undefined;
    this.emit("seat:disconnected", { room, slot: seat.slot, graceMs: this.reconnectGraceMs });

    if (room.status !== "active") return; // waiting-room drops just re-open the seat

    const timer = setTimeout(() => {
      this.graceTimers.delete(timerKey(binding.roomId, seat.slot));
      const current = this.rooms.get(binding.roomId);
      if (!current) return;
      const currentSeat = current.seats.find((s) => s.slot === seat.slot);
      if (!currentSeat || currentSeat.connected) return; // reconnected in the meantime
      currentSeat.sessionToken = undefined;
      current.status = "abandoned";
      this.emit("room:abandoned", { room: current, reason: "disconnect-timeout" });
    }, this.reconnectGraceMs);
    timer.unref?.();
    this.graceTimers.set(timerKey(binding.roomId, seat.slot), timer);
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  /**
   * The room/slot a connected socket is bound to (set on `room:create`'s auto-join and
   * `room:join`). Used by gameplay handlers (MPG-013) to derive whose seat a `move`
   * intent came from — never trust a client-declared slot.
   */
  getSocketSeat(socketId: string): { roomId: string; slot: Slot } | undefined {
    return this.sockets.get(socketId);
  }

  /**
   * True if `token` is `roomId`'s creator credential (see `Room.creatorToken`).
   * Used to gate watch-join for a socket that holds no seat — e.g. an all-bot
   * room's creator reconnecting via `room:state` (MPG-025). Deliberately narrow:
   * this is NOT "anyone who knows the roomId" (that's the deferred MPG-027).
   */
  isCreatorToken(roomId: string, token: string): boolean {
    const room = this.getRoom(roomId);
    return room !== undefined && room.creatorToken === token;
  }

  getRoom(roomId: string): Room | undefined {
    const room = this.rooms.get(roomId);
    if (room && room.expiresAt < Date.now()) {
      this.expire(room.id);
      return undefined;
    }
    return room;
  }

  toPublicRoom(room: Room): PublicRoom {
    const seats: PublicSeat[] = room.seats.map((seat) => ({
      slot: seat.slot,
      kind: seat.kind,
      difficulty: seat.difficulty,
      displayName: seat.displayName,
      team: seat.team,
      open: seat.kind === "human" && !seat.sessionToken,
      connected: seat.connected,
    }));

    return {
      roomId: room.id,
      gameId: room.gameId,
      status: room.status,
      turn: room.turn,
      state: room.state,
      seats,
    };
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private requireRoom(roomId: string): Room {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new RoomManagerError("NOT_FOUND", `Room not found: ${roomId}`);
    }
    return room;
  }

  private findOpenHumanSeat(room: Room, seatIndex?: number): Seat | undefined {
    if (seatIndex !== undefined) {
      const seat = room.seats.find((s) => s.slot === seatIndex);
      if (!seat) throw new RoomManagerError("SEAT_NOT_FOUND", `No seat at slot ${seatIndex}`);
      if (seat.kind !== "human" || seat.sessionToken) {
        throw new RoomManagerError("SEAT_TAKEN", `Seat ${seatIndex} is not an open human seat`);
      }
      return seat;
    }
    return room.seats.find((s) => s.kind === "human" && !s.sessionToken);
  }

  private touch(room: Room): void {
    room.expiresAt = Date.now() + this.ttlMs;
  }

  private clearGraceTimer(roomId: string, slot: Slot): void {
    const key = timerKey(roomId, slot);
    const timer = this.graceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(key);
    }
  }

  private expire(roomId: string): void {
    this.rooms.delete(roomId);
    for (const [socketId, binding] of this.sockets) {
      if (binding.roomId === roomId) this.sockets.delete(socketId);
    }
    for (const key of this.graceTimers.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        clearTimeout(this.graceTimers.get(key));
        this.graceTimers.delete(key);
      }
    }
    this.emit("room:expired", { roomId });
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.expiresAt < now) this.expire(room.id);
    }
  }

  private validateSeatConfig(seatConfig: SeatConfig[], expectedCount: number): void {
    if (seatConfig.length !== expectedCount) {
      throw new RoomManagerError(
        "INVALID_SEATS",
        `Expected ${expectedCount} seats, got ${seatConfig.length}`,
      );
    }
    const slots = new Set<number>();
    let selfCount = 0;
    for (const seat of seatConfig) {
      if (seat.slot < 1 || seat.slot > expectedCount || !Number.isInteger(seat.slot)) {
        throw new RoomManagerError("INVALID_SEATS", `Invalid slot: ${seat.slot}`);
      }
      if (slots.has(seat.slot)) {
        throw new RoomManagerError("INVALID_SEATS", `Duplicate slot: ${seat.slot}`);
      }
      slots.add(seat.slot);
      if (seat.kind === "human" && seat.self) selfCount++;
      if (seat.kind === "bot" && !seat.difficulty) {
        throw new RoomManagerError("INVALID_SEATS", `Bot seat ${seat.slot} missing difficulty`);
      }
    }
    if (selfCount > 1) {
      throw new RoomManagerError("INVALID_SEATS", "At most one self human seat allowed");
    }
  }
}

function hasOpenHumanSeat(seats: Seat[]): boolean {
  return seats.some((s) => s.kind === "human" && !s.sessionToken);
}

function timerKey(roomId: string, slot: Slot): string {
  return `${roomId}:${slot}`;
}
