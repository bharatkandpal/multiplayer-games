// Socket.IO wiring for the rematch flow (MPG-015): `rematch:propose` /
// `rematch:decline` from clients, `rematch:proposed` / `rematch:declined` /
// `rematch:start` broadcasts back out.
//
// Mirrors roomHandlers.ts / moveHandler.ts's shape — this is the only module
// that touches raw Socket.IO for rematch concerns; the actual proposal
// bookkeeping and new-room creation lives on `RoomManager` (see
// `proposeRematch`/`declineRematch`/`createRematchRoom`) so it's testable
// without a transport in the loop.

import type { Server, Socket } from "socket.io";

import { RoomManager, RoomManagerError } from "./RoomManager.js";
import type { Room, Slot } from "./types.js";

interface RematchErrorPayload {
  code: string;
  message: string;
}

type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: RematchErrorPayload }) => void;

function isAck(value: unknown): value is Ack<unknown> {
  return typeof value === "function";
}

interface RematchPayload {
  roomId: string;
  sessionToken: string;
}

function parsePayload(payload: unknown): RematchPayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as Record<string, unknown>;
  if (typeof p["roomId"] !== "string" || p["roomId"].length === 0) return undefined;
  if (typeof p["sessionToken"] !== "string" || p["sessionToken"].length === 0) return undefined;
  return { roomId: p["roomId"], sessionToken: p["sessionToken"] };
}

function toErrorPayload(err: unknown): RematchErrorPayload {
  if (err instanceof RoomManagerError) {
    return { code: err.code, message: err.message };
  }
  return { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Unknown error" };
}

/**
 * Register rematch handlers on `io`, backed by `roomManager`.
 *
 * Like roomHandlers.ts, `roomManager`'s own events drive the broadcasts —
 * handlers below only translate client intents into `RoomManager` calls.
 */
export function registerRematchHandlers(io: Server, roomManager: RoomManager): void {
  roomManager.on("rematch:proposed", ({ room, slot }: { room: Room; slot: Slot }) => {
    io.to(room.id).emit("rematch:proposed", { from: slot });
  });

  roomManager.on("rematch:declined", ({ room, slot }: { room: Room; slot: Slot }) => {
    io.to(room.id).emit("rematch:declined", { from: slot });
  });

  // Every human seat proposed: rebind each still-connected socket from the old
  // room into the freshly-created one (same session token, so it lands on the
  // same seat), then point it at its new home.
  //
  // Two passes, deliberately: `socket.join(newRoom.id)` for EVERY socket
  // happens before ANY `roomManager.joinRoom(...)` bookkeeping call. The
  // latter emits `room:updated`, which is what drives the `game:start`
  // broadcast (moveHandler.ts) once all human seats are filled — and with
  // a rematch, both seats fill on the very first bookkeeping call (session
  // tokens already carried over from the source room). Doing bookkeeping
  // per-seat in a single pass fired that broadcast after only the first
  // socket had joined the new Socket.IO room, so the second player's client
  // never received it and hung on "Connecting…" forever (found via
  // MPG-017's e2e rematch step).
  roomManager.on("rematch:matched", ({ room, newRoom }: { room: Room; newRoom: Room }) => {
    const rebinding: { seatSessionToken: string; socket: ReturnType<typeof io.sockets.sockets.get> }[] =
      [];
    for (const seat of room.seats) {
      if (seat.kind !== "human" || !seat.sessionToken || !seat.socketId) continue;
      const socket = io.sockets.sockets.get(seat.socketId);
      if (!socket) continue;

      void socket.join(newRoom.id);
      void socket.leave(room.id);
      rebinding.push({ seatSessionToken: seat.sessionToken, socket });
    }

    for (const { seatSessionToken, socket } of rebinding) {
      if (!socket) continue;
      try {
        roomManager.joinRoom(newRoom.id, seatSessionToken, { socketId: socket.id });
      } catch (err) {
        console.error("Failed to rebind socket into rematch room", err);
        continue;
      }
      socket.emit("rematch:start", { roomId: newRoom.id });
    }
  });

  io.on("connection", (socket: Socket) => {
    socket.on("rematch:propose", (payload: unknown, ack?: unknown) => {
      const callback = isAck(ack) ? ack : undefined;
      const parsed = parsePayload(payload);
      if (!parsed) {
        const error = { code: "INVALID_PAYLOAD", message: "Invalid rematch:propose payload" };
        socket.emit("rematch:error", error);
        callback?.({ ok: false, error });
        return;
      }

      try {
        const { allProposed, newRoom } = roomManager.proposeRematch(
          parsed.roomId,
          parsed.sessionToken,
        );
        callback?.({ ok: true, data: { allProposed, newRoomId: newRoom?.id } });
      } catch (err) {
        const error = toErrorPayload(err);
        socket.emit("rematch:error", error);
        callback?.({ ok: false, error });
      }
    });

    socket.on("rematch:decline", (payload: unknown, ack?: unknown) => {
      const callback = isAck(ack) ? ack : undefined;
      const parsed = parsePayload(payload);
      if (!parsed) {
        const error = { code: "INVALID_PAYLOAD", message: "Invalid rematch:decline payload" };
        socket.emit("rematch:error", error);
        callback?.({ ok: false, error });
        return;
      }

      try {
        roomManager.declineRematch(parsed.roomId, parsed.sessionToken);
        callback?.({ ok: true, data: {} });
      } catch (err) {
        const error = toErrorPayload(err);
        socket.emit("rematch:error", error);
        callback?.({ ok: false, error });
      }
    });
  });
}
