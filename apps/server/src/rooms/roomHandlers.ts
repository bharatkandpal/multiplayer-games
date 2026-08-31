// Socket.IO wiring for room lifecycle (create/join/leave/state).
//
// Keeps raw Socket.IO calls out of RoomManager: this module is the only place
// that touches `io`/`socket` for room concerns, so the transport stays swappable
// (docs/ARCHITECTURE.md, docs/TDD.md §2 guardrails).
//
// Gameplay events (`move`, `game:start`, rematch, etc. — docs/API_SPEC.md §3) are
// out of scope here; MPG-011 is the room manager + its transport wiring only.

import type { Server, Socket } from "socket.io";

import { nanoid } from "nanoid";

import { RoomManager, RoomManagerError } from "./RoomManager.js";
import type { SeatConfig } from "./types.js";

interface RoomErrorPayload {
  code: string;
  message: string;
}

type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: RoomErrorPayload }) => void;

function isAck(value: unknown): value is Ack<unknown> {
  return typeof value === "function";
}

// --- Minimal runtime payload validation (no external schema lib; keep it small) ---

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isSeatConfig(v: unknown): v is SeatConfig {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  if (typeof s["slot"] !== "number") return false;
  if (s["kind"] === "human") {
    return (
      (s["self"] === undefined || typeof s["self"] === "boolean") &&
      (s["displayName"] === undefined || typeof s["displayName"] === "string")
    );
  }
  if (s["kind"] === "bot") {
    return (
      typeof s["difficulty"] === "string" && ["easy", "medium", "hard"].includes(s["difficulty"])
    );
  }
  return false;
}

interface RoomCreatePayload {
  gameId: string;
  seats: SeatConfig[];
}

function parseCreatePayload(payload: unknown): RoomCreatePayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as Record<string, unknown>;
  if (!isNonEmptyString(p["gameId"])) return undefined;
  if (!Array.isArray(p["seats"]) || !p["seats"].every(isSeatConfig)) return undefined;
  return { gameId: p["gameId"], seats: p["seats"] };
}

interface RoomJoinPayload {
  roomId: string;
  sessionToken?: string | undefined;
  seatIndex?: number | undefined;
  displayName?: string | undefined;
}

function parseJoinPayload(payload: unknown): RoomJoinPayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as Record<string, unknown>;
  if (!isNonEmptyString(p["roomId"])) return undefined;
  if (p["sessionToken"] !== undefined && !isNonEmptyString(p["sessionToken"])) return undefined;
  if (p["seatIndex"] !== undefined && typeof p["seatIndex"] !== "number") return undefined;
  if (p["displayName"] !== undefined && typeof p["displayName"] !== "string") return undefined;
  return {
    roomId: p["roomId"],
    sessionToken: p["sessionToken"] as string | undefined,
    seatIndex: p["seatIndex"] as number | undefined,
    displayName: p["displayName"] as string | undefined,
  };
}

interface RoomLeavePayload {
  roomId: string;
  sessionToken: string;
}

function parseLeavePayload(payload: unknown): RoomLeavePayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as Record<string, unknown>;
  if (!isNonEmptyString(p["roomId"]) || !isNonEmptyString(p["sessionToken"])) return undefined;
  return { roomId: p["roomId"], sessionToken: p["sessionToken"] };
}

interface RoomStatePayload {
  roomId: string;
  creatorToken?: string | undefined;
}

function parseStatePayload(payload: unknown): RoomStatePayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as Record<string, unknown>;
  if (!isNonEmptyString(p["roomId"])) return undefined;
  if (p["creatorToken"] !== undefined && !isNonEmptyString(p["creatorToken"])) return undefined;
  return { roomId: p["roomId"], creatorToken: p["creatorToken"] as string | undefined };
}

function toErrorPayload(err: unknown): RoomErrorPayload {
  if (err instanceof RoomManagerError) {
    return { code: err.code, message: err.message };
  }
  return { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Unknown error" };
}

/**
 * Register room lifecycle handlers on `io`, backed by `roomManager`.
 *
 * `roomManager`'s own events are the single source of truth for broadcasts — handlers
 * below only translate client intents into RoomManager calls; RoomManager state changes
 * flow back out to sockets via the subscriptions at the bottom of this function.
 */
export function registerRoomHandlers(io: Server, roomManager: RoomManager): void {
  // RoomManager -> Socket.IO broadcasts (fires for create/join/leave/expire/disconnect).
  roomManager.on("room:updated", (room) => {
    io.to(room.id).emit("room:updated", { room: roomManager.toPublicRoom(room) });
  });
  roomManager.on("seat:disconnected", ({ room, graceMs }) => {
    io.to(room.id).emit("opponent:disconnected", { graceMs });
  });
  roomManager.on("seat:reconnected", ({ room }) => {
    io.to(room.id).emit("opponent:reconnected", {});
  });
  roomManager.on("room:abandoned", ({ room, reason }) => {
    io.to(room.id).emit("room:abandoned", { reason });
  });

  io.on("connection", (socket: Socket) => {
    socket.on("room:create", (payload: unknown, ack?: unknown) => {
      const callback = isAck(ack) ? ack : undefined;
      const parsed = parseCreatePayload(payload);
      if (!parsed) {
        const error = { code: "INVALID_PAYLOAD", message: "Invalid room:create payload" };
        socket.emit("room:error", error);
        callback?.({ ok: false, error });
        return;
      }

      // Reserve the room ID and join the Socket.IO room *before* `createRoom` runs —
      // `createRoom` itself emits `room:updated` (and downstream events like
      // `game:start`) synchronously, so this socket must already be a member to
      // receive its own broadcast. This has to happen unconditionally, not just for
      // a `self` seat: an all-bot config leaves this socket with no seat to rebind,
      // but its creator must still land in the room's channel to watch the bots play
      // (MPG-025) — a room with no open human seats is already `active` (and thus
      // already broadcasting `game:start`) the instant `createRoom` returns.
      // (The default in-process adapter applies membership synchronously.)
      const roomId = roomManager.reserveRoomId();
      void socket.join(roomId);

      try {
        const { room, sessionTokens, creatorToken } = roomManager.createRoom(
          parsed.gameId,
          parsed.seats,
          { roomId },
        );
        const selfSlot = parsed.seats.find((s) => s.kind === "human" && s.self)?.slot;
        const sessionToken = selfSlot !== undefined ? sessionTokens.get(selfSlot) : undefined;

        if (selfSlot !== undefined && sessionToken) {
          // Seat already exists (assigned in createRoom); this rebinds the live socket to it.
          roomManager.joinRoom(room.id, sessionToken, { socketId: socket.id });
        }

        const publicRoom = roomManager.toPublicRoom(room);
        // `creatorToken` lets the creator watch-rejoin (via `room:state`) later —
        // e.g. after a page refresh of an all-bot watch room, where there's no seat
        // (and so no `sessionToken`) to reconnect with.
        const data = {
          room: publicRoom,
          roomId: room.id,
          sessionToken,
          yourSlot: selfSlot,
          creatorToken,
        };
        socket.emit("room:created", data);
        callback?.({ ok: true, data });
      } catch (err) {
        void socket.leave(roomId);
        const error = toErrorPayload(err);
        socket.emit("room:error", error);
        callback?.({ ok: false, error });
      }
    });

    socket.on("room:join", (payload: unknown, ack?: unknown) => {
      const callback = isAck(ack) ? ack : undefined;
      const parsed = parseJoinPayload(payload);
      if (!parsed) {
        const error = { code: "INVALID_PAYLOAD", message: "Invalid room:join payload" };
        socket.emit("room:error", error);
        callback?.({ ok: false, error });
        return;
      }

      try {
        const sessionToken = parsed.sessionToken ?? nanoid();
        // Join the Socket.IO room *before* calling into the manager — `joinRoom` emits
        // `room:updated` (and downstream events like `game:start`) synchronously, so
        // this socket must already be a room member to receive its own broadcast.
        void socket.join(parsed.roomId);

        let room, seat;
        try {
          ({ room, seat } = roomManager.joinRoom(parsed.roomId, sessionToken, {
            seatIndex: parsed.seatIndex,
            displayName: parsed.displayName,
            socketId: socket.id,
          }));
        } catch (err) {
          void socket.leave(parsed.roomId);
          throw err;
        }

        const data = { room: roomManager.toPublicRoom(room), yourSlot: seat.slot, sessionToken };
        callback?.({ ok: true, data });
      } catch (err) {
        const error = toErrorPayload(err);
        socket.emit("room:error", error);
        callback?.({ ok: false, error });
      }
    });

    socket.on("room:leave", (payload: unknown, ack?: unknown) => {
      const callback = isAck(ack) ? ack : undefined;
      const parsed = parseLeavePayload(payload);
      if (!parsed) {
        const error = { code: "INVALID_PAYLOAD", message: "Invalid room:leave payload" };
        socket.emit("room:error", error);
        callback?.({ ok: false, error });
        return;
      }

      try {
        const room = roomManager.leaveRoom(parsed.roomId, parsed.sessionToken);
        void socket.leave(parsed.roomId);
        callback?.({ ok: true, data: { room: roomManager.toPublicRoom(room) } });
      } catch (err) {
        const error = toErrorPayload(err);
        socket.emit("room:error", error);
        callback?.({ ok: false, error });
      }
    });

    socket.on("room:state", (payload: unknown, ack?: unknown) => {
      const callback = isAck(ack) ? ack : undefined;
      const parsed = parseStatePayload(payload);
      if (!parsed) {
        const error = { code: "INVALID_PAYLOAD", message: "Invalid room:state payload" };
        socket.emit("room:error", error);
        callback?.({ ok: false, error });
        return;
      }

      const room = roomManager.getRoom(parsed.roomId);
      if (!room) {
        const error = { code: "NOT_FOUND", message: `Room not found: ${parsed.roomId}` };
        socket.emit("room:error", error);
        callback?.({ ok: false, error });
        return;
      }

      // Watch-join: a socket presenting the room's `creatorToken` joins the Socket.IO
      // room so it starts receiving future broadcasts (`game:update`/`game:over`/
      // `room:updated`) — the only way an all-bot room's creator can watch after a
      // page refresh, since there's no seat (and so no `sessionToken`) to reconnect
      // with via `room:join`. A missing/incorrect token is a silent no-op: this is
      // deliberately NOT "anyone who knows the roomId can watch" (that's the
      // separately-tracked MPG-027 public-spectator case).
      if (parsed.creatorToken && roomManager.isCreatorToken(parsed.roomId, parsed.creatorToken)) {
        void socket.join(parsed.roomId);
      }

      const data = { room: roomManager.toPublicRoom(room) };
      socket.emit("room:updated", data);
      callback?.({ ok: true, data });
    });

    socket.on("disconnect", () => {
      roomManager.handleSocketDisconnect(socket.id);
    });
  });
}
