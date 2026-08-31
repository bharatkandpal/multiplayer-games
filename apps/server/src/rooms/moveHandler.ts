// Gameplay Socket.IO wiring (MPG-013): `move`, `game:start`, `game:update`,
// `game:over`, `move:rejected` — see docs/API_SPEC.md §3.1–3.2.
//
// Mirrors roomHandlers.ts's shape: this is the only module that touches raw
// Socket.IO for gameplay concerns, keeping the transport swappable
// (docs/ARCHITECTURE.md). Bot seats are never sockets; their turns are driven by
// `BotRunner` (MPG-014, server-side AI runner) — wired up below so bot moves reuse
// this module's exact `game:update`/`game:over` broadcast + persistence path.

import type { Server, Socket } from "socket.io";

import type { Result } from "@mpg/engine";

import { BotRunner } from "./botRunner.js";
import { applyPlayerMove } from "./gameState.js";
import { RoomManager } from "./RoomManager.js";
import type { Room, Seat, Slot } from "./types.js";
import { updateLeaderboardsForTurnBasedGameOver } from "../leaderboard/leaderboardWriter.js";
import { writeGameResult } from "../sessions/resultWriter.js";
import type { Store } from "../store/ports.js";

interface MoveErrorPayload {
  code: string;
  message: string;
}

type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: MoveErrorPayload }) => void;

function isAck(value: unknown): value is Ack<unknown> {
  return typeof value === "function";
}

interface MovePayload {
  roomId: string;
  move: unknown;
}

function parseMovePayload(payload: unknown): MovePayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as Record<string, unknown>;
  if (typeof p["roomId"] !== "string" || p["roomId"].length === 0) return undefined;
  if (!("move" in p)) return undefined;
  return { roomId: p["roomId"], move: p["move"] };
}

/**
 * Register gameplay handlers on `io`, backed by `roomManager` and (for game-over
 * persistence) `store`.
 *
 * Like `registerRoomHandlers`, `roomManager`'s own events drive the `game:start`
 * broadcast (fired on the waiting→active transition); everything else here is a
 * direct response to a client's `move` intent.
 */
export function registerGameHandlers(io: Server, roomManager: RoomManager, store: Store): void {
  // Track each room's last-seen status so we can detect the waiting→active edge
  // (all seats filled) and emit `game:start` exactly once for it.
  const lastStatus = new Map<string, Room["status"]>();

  // Broadcasts + persists exactly like a human move (`emitUpdate`/`emitGameOver` below),
  // so bot-applied moves are indistinguishable to clients from human ones except for
  // `lastMove.slot` pointing at a bot seat.
  const botRunner = new BotRunner(roomManager, {
    onUpdate: (room, lastMove) => emitUpdate(io, roomManager, room, lastMove),
    onGameOver: (room, result) => emitGameOver(io, roomManager, store, room, result),
  });

  roomManager.on("room:updated", (room: Room) => {
    const previous = lastStatus.get(room.id);
    lastStatus.set(room.id, room.status);
    if (room.status === "active" && previous !== "active") {
      io.to(room.id).emit("game:start", { room: roomManager.toPublicRoom(room) });
      // Covers a bot holding the very first turn (human-vs-bot where the bot goes
      // first, or an all-bot "watch" room) — natural (unpaced) reply delay.
      botRunner.scheduleNext(room, false);
    }
  });
  roomManager.on("room:expired", ({ roomId }: { roomId: string }) => {
    lastStatus.delete(roomId);
    botRunner.cancel(roomId);
  });
  roomManager.on("room:abandoned", ({ room }: { room: Room }) => {
    botRunner.cancel(room.id);
  });

  io.on("connection", (socket: Socket) => {
    socket.on("move", (payload: unknown, ack?: unknown) => {
      const callback = isAck(ack) ? ack : undefined;
      const parsed = parseMovePayload(payload);
      if (!parsed) {
        const error = { code: "INVALID_PAYLOAD", message: "Invalid move payload" };
        socket.emit("error", error);
        callback?.({ ok: false, error });
        return;
      }

      const binding = roomManager.getSocketSeat(socket.id);
      if (!binding || binding.roomId !== parsed.roomId) {
        const error = { code: "NOT_A_MEMBER", message: "You do not hold a seat in this room" };
        socket.emit("error", error);
        callback?.({ ok: false, error });
        return;
      }

      const room = roomManager.getRoom(parsed.roomId);
      if (!room) {
        const error = { code: "NOT_FOUND", message: `Room not found: ${parsed.roomId}` };
        socket.emit("error", error);
        callback?.({ ok: false, error });
        return;
      }

      const seat = room.seats.find((s) => s.slot === binding.slot);
      if (!seat || seat.kind !== "human") {
        const error = { code: "NOT_A_MEMBER", message: "Bot seats do not accept client moves" };
        socket.emit("error", error);
        callback?.({ ok: false, error });
        return;
      }

      const outcome = applyPlayerMove(room, binding.slot, parsed.move);
      if (!outcome.ok) {
        socket.emit("move:rejected", { reason: outcome.reason });
        callback?.({ ok: false, error: { code: outcome.reason, message: "Move rejected" } });
        return;
      }

      const publicRoom = emitUpdate(io, roomManager, room, {
        slot: binding.slot,
        move: parsed.move,
      });

      if (outcome.result.status !== "in_progress") {
        emitGameOver(io, roomManager, store, room, outcome.result);
      } else {
        // A human just moved — if the next turn belongs to a bot seat, the server-side
        // AI runner takes over (single authoritative path via `applyPlayerMove`), with a
        // natural (unpaced) reply delay.
        botRunner.scheduleNext(room, false);
      }

      callback?.({ ok: true, data: { room: publicRoom } });
    });
  });
}

/** Broadcasts `game:update` for a just-applied move (human or bot). Returns the
 * `PublicRoom` projection sent, for callers that also need it (e.g. the move ack). */
function emitUpdate(
  io: Server,
  roomManager: RoomManager,
  room: Room,
  lastMove: { slot: Slot; move: unknown },
): ReturnType<RoomManager["toPublicRoom"]> {
  const publicRoom = roomManager.toPublicRoom(room);
  io.to(room.id).emit("game:update", { room: publicRoom, lastMove });
  return publicRoom;
}

/** Broadcasts `game:over` and fires the (fire-and-forget) result persistence. */
function emitGameOver(
  io: Server,
  roomManager: RoomManager,
  store: Store,
  room: Room,
  result: Result,
): void {
  const publicRoom = roomManager.toPublicRoom(room);
  io.to(room.id).emit("game:over", { room: publicRoom, result });
  void persistResults(store, room, result).catch((err: unknown) => {
    console.error("Failed to persist game result", err);
  });
}

/**
 * Persist one idempotent `GameResult` per human seat (each row owned by that seat's
 * session token, so it surfaces in their `/api/session/history`). Bot seats have no
 * session and are recorded only in `seatsSnapshot`.
 */
async function persistResults(store: Store, room: Room, result: Result): Promise<void> {
  const winnerSlot = result.status === "win" ? result.winner : null;
  const seatsSnapshot = room.seats.map((seat) => ({
    slot: seat.slot,
    kind: seat.kind,
    difficulty: seat.difficulty,
    displayName: seat.displayName,
  }));
  const durationMs = Date.now() - room.createdAt;

  const humanSeats = room.seats.filter(
    (seat): seat is Seat & { sessionToken: string } =>
      seat.kind === "human" && typeof seat.sessionToken === "string",
  );

  await Promise.all(
    humanSeats.map((seat) =>
      writeGameResult(store, {
        runId: `${room.runId}:${seat.slot}`,
        gameId: room.gameId,
        gameFamily: "turn-based",
        ownerToken: seat.sessionToken,
        status: result.status,
        winnerSlot,
        seatsSnapshot,
        durationMs,
        moveLog: room.moveLog,
      }),
    ),
  );

  if (result.status === "win" || result.status === "draw") {
    await updateLeaderboardsForTurnBasedGameOver(
      store,
      room.gameId,
      room.seats,
      result.status === "win" ? { status: "win", winner: result.winner } : { status: "draw" },
      { runId: room.runId },
    );
  }
}
