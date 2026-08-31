import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { registerBuiltInGames, clearRegistry } from "@mpg/engine";

import { RoomManager, RoomManagerError } from "../RoomManager.js";
import type { SeatConfig } from "../types.js";

const vsBotSeats: SeatConfig[] = [
  { slot: 1, kind: "human", self: true, displayName: "Bharat" },
  { slot: 2, kind: "bot", difficulty: "hard" },
];

const linkShareSeats: SeatConfig[] = [
  { slot: 1, kind: "human", self: true, displayName: "Host" },
  { slot: 2, kind: "human" },
];

const watchSeats: SeatConfig[] = [
  { slot: 1, kind: "bot", difficulty: "medium" },
  { slot: 2, kind: "bot", difficulty: "hard" },
];

describe("RoomManager", () => {
  let manager: RoomManager;

  beforeEach(() => {
    try {
      registerBuiltInGames();
    } catch {
      // already registered by a previous test file in this process
    }
  });

  afterEach(() => {
    manager.destroy();
    clearRegistry();
    registerBuiltInGames();
  });

  describe("createRoom", () => {
    it("creates a waiting room when a human seat is open", () => {
      manager = new RoomManager();
      const { room } = manager.createRoom("tictactoe", linkShareSeats);
      expect(room.status).toBe("waiting");
      expect(room.seats).toHaveLength(2);
      expect(room.id).toBeTruthy();
    });

    it("creates an active room when there are no open human seats (vs bot)", () => {
      manager = new RoomManager();
      const { room } = manager.createRoom("tictactoe", vsBotSeats);
      expect(room.status).toBe("active");
    });

    it("creates an active all-bot watch room", () => {
      manager = new RoomManager();
      const { room } = manager.createRoom("tictactoe", watchSeats);
      expect(room.status).toBe("active");
      expect(room.seats.every((s) => s.kind === "bot")).toBe(true);
    });

    it("issues a session token for the self seat", () => {
      manager = new RoomManager();
      const { room, sessionTokens } = manager.createRoom("tictactoe", vsBotSeats);
      expect(sessionTokens.get(1)).toBeTruthy();
      expect(room.seats[0]?.sessionToken).toBe(sessionTokens.get(1));
    });

    it("rejects an unknown game id", () => {
      manager = new RoomManager();
      expect(() => manager.createRoom("chess", vsBotSeats)).toThrow(RoomManagerError);
    });

    it("rejects a seat count mismatch", () => {
      manager = new RoomManager();
      expect(() =>
        manager.createRoom("tictactoe", [{ slot: 1, kind: "human", self: true }]),
      ).toThrow(RoomManagerError);
    });

    it("rejects duplicate slots", () => {
      manager = new RoomManager();
      expect(() =>
        manager.createRoom("tictactoe", [
          { slot: 1, kind: "human", self: true },
          { slot: 1, kind: "bot", difficulty: "easy" },
        ]),
      ).toThrow(RoomManagerError);
    });

    it("rejects a bot seat missing difficulty", () => {
      manager = new RoomManager();
      expect(() =>
        manager.createRoom("tictactoe", [
          { slot: 1, kind: "human", self: true },
          // @ts-expect-error intentionally malformed for the test
          { slot: 2, kind: "bot" },
        ]),
      ).toThrow(RoomManagerError);
    });

    it("rejects more than one self seat", () => {
      manager = new RoomManager();
      expect(() =>
        manager.createRoom("tictactoe", [
          { slot: 1, kind: "human", self: true },
          { slot: 2, kind: "human", self: true },
        ]),
      ).toThrow(RoomManagerError);
    });
  });

  describe("joinRoom / leaveRoom", () => {
    it("assigns the next open human seat", () => {
      manager = new RoomManager();
      const { room } = manager.createRoom("tictactoe", linkShareSeats);
      const { seat } = manager.joinRoom(room.id, "guest-token");
      expect(seat.slot).toBe(2);
      expect(seat.connected).toBe(true);
    });

    it("flips a room to active once every human seat is filled", () => {
      manager = new RoomManager();
      const { room } = manager.createRoom("tictactoe", linkShareSeats);
      manager.joinRoom(room.id, "guest-token");
      expect(manager.getRoom(room.id)?.status).toBe("active");
    });

    it("rejects joining a room with no open seats", () => {
      manager = new RoomManager();
      const { room } = manager.createRoom("tictactoe", linkShareSeats);
      manager.joinRoom(room.id, "guest-token");
      expect(() => manager.joinRoom(room.id, "another-guest")).toThrow(RoomManagerError);
    });

    it("rejects joining an unknown room", () => {
      manager = new RoomManager();
      expect(() => manager.joinRoom("nope", "tok")).toThrow(RoomManagerError);
    });

    it("re-joining with the same session token rebinds (reconnect), not a new seat", () => {
      manager = new RoomManager();
      const { room } = manager.createRoom("tictactoe", linkShareSeats);
      const first = manager.joinRoom(room.id, "guest-token", { socketId: "sock-1" });
      const second = manager.joinRoom(room.id, "guest-token", { socketId: "sock-2" });
      expect(second.seat.slot).toBe(first.seat.slot);
      expect(
        manager.getRoom(room.id)?.seats.filter((s) => s.sessionToken === "guest-token"),
      ).toHaveLength(1);
    });

    it("leaveRoom frees a waiting seat back to open", () => {
      manager = new RoomManager();
      const { room, sessionTokens } = manager.createRoom("tictactoe", linkShareSeats);
      const hostToken = sessionTokens.get(1)!;
      const updated = manager.leaveRoom(room.id, hostToken);
      expect(updated.status).toBe("waiting");
      expect(updated.seats[0]?.sessionToken).toBeUndefined();
    });

    it("leaveRoom rejects a session that holds no seat", () => {
      manager = new RoomManager();
      const { room } = manager.createRoom("tictactoe", linkShareSeats);
      expect(() => manager.leaveRoom(room.id, "stranger")).toThrow(RoomManagerError);
    });

    it("an active room abandons when the last connected human leaves", () => {
      manager = new RoomManager();
      const { room, sessionTokens } = manager.createRoom("tictactoe", linkShareSeats);
      manager.joinRoom(room.id, "guest-token");
      const hostToken = sessionTokens.get(1)!;
      manager.leaveRoom(room.id, hostToken);
      const updated = manager.leaveRoom(room.id, "guest-token");
      expect(updated.status).toBe("abandoned");
    });
  });

  describe("getRoom / toPublicRoom", () => {
    it("returns undefined for a missing room", () => {
      manager = new RoomManager();
      expect(manager.getRoom("missing")).toBeUndefined();
    });

    it("hides session tokens and socket ids from the public projection", () => {
      manager = new RoomManager();
      const { room } = manager.createRoom("tictactoe", vsBotSeats);
      const publicRoom = manager.toPublicRoom(room);
      expect(publicRoom.seats[0]).not.toHaveProperty("sessionToken");
      expect(publicRoom.seats[0]).not.toHaveProperty("socketId");
      expect(publicRoom.roomId).toBe(room.id);
    });

    it("marks an unfilled human seat as open", () => {
      manager = new RoomManager();
      const { room } = manager.createRoom("tictactoe", linkShareSeats);
      const publicRoom = manager.toPublicRoom(room);
      expect(publicRoom.seats[1]?.open).toBe(true);
      expect(publicRoom.seats[0]?.open).toBe(false);
    });
  });

  describe("expiry", () => {
    it("expires a room once its TTL has elapsed", () => {
      manager = new RoomManager({ ttlMs: 10 });
      const { room } = manager.createRoom("tictactoe", vsBotSeats);
      expect(manager.getRoom(room.id)).toBeDefined();

      vi.useFakeTimers();
      vi.advanceTimersByTime(50);
      expect(manager.getRoom(room.id)).toBeUndefined();
      vi.useRealTimers();
    });

    it("the periodic sweep removes expired rooms and emits room:expired", () => {
      vi.useFakeTimers();
      manager = new RoomManager({ ttlMs: 10, sweepIntervalMs: 20 });
      const { room } = manager.createRoom("tictactoe", vsBotSeats);
      const onExpired = vi.fn();
      manager.on("room:expired", onExpired);

      vi.advanceTimersByTime(25);
      expect(onExpired).toHaveBeenCalledWith({ roomId: room.id });
      vi.useRealTimers();
    });
  });

  describe("disconnect grace", () => {
    it("marks a seat disconnected and emits seat:disconnected", () => {
      manager = new RoomManager({ reconnectGraceMs: 1000 });
      const { room } = manager.createRoom("tictactoe", linkShareSeats);
      manager.joinRoom(room.id, "guest-token", { socketId: "sock-1" });

      const onDisconnected = vi.fn();
      manager.on("seat:disconnected", onDisconnected);
      manager.handleSocketDisconnect("sock-1");

      expect(onDisconnected).toHaveBeenCalledTimes(1);
      expect(manager.getRoom(room.id)?.seats[1]?.connected).toBe(false);
    });

    it("reconnecting within grace clears the seat's disconnected state", () => {
      vi.useFakeTimers();
      manager = new RoomManager({ reconnectGraceMs: 1000 });
      const { room } = manager.createRoom("tictactoe", linkShareSeats);
      manager.joinRoom(room.id, "guest-token", { socketId: "sock-1" });
      manager.handleSocketDisconnect("sock-1");

      vi.advanceTimersByTime(200);
      const onReconnected = vi.fn();
      manager.on("seat:reconnected", onReconnected);
      manager.joinRoom(room.id, "guest-token", { socketId: "sock-2" });

      expect(onReconnected).toHaveBeenCalledTimes(1);
      expect(manager.getRoom(room.id)?.seats[1]?.connected).toBe(true);
      vi.useRealTimers();
    });

    it("an active room is abandoned if the human doesn't reconnect within grace", () => {
      vi.useFakeTimers();
      manager = new RoomManager({ reconnectGraceMs: 500 });
      const { room, sessionTokens } = manager.createRoom("tictactoe", vsBotSeats);
      manager.joinRoom(room.id, sessionTokens.get(1)!, { socketId: "sock-1" });

      const onAbandoned = vi.fn();
      manager.on("room:abandoned", onAbandoned);
      manager.handleSocketDisconnect("sock-1");

      vi.advanceTimersByTime(600);
      expect(onAbandoned).toHaveBeenCalledTimes(1);
      expect(manager.getRoom(room.id)?.status).toBe("abandoned");
      vi.useRealTimers();
    });

    it("a waiting room's host drop does not start a grace timer or abandon", () => {
      vi.useFakeTimers();
      manager = new RoomManager({ reconnectGraceMs: 500 });
      const { room, sessionTokens } = manager.createRoom("tictactoe", linkShareSeats);
      const hostToken = sessionTokens.get(1)!;
      // Seat 2 stays open, so the room is still "waiting" when the host drops.
      manager.joinRoom(room.id, hostToken, { socketId: "sock-host" });
      manager.handleSocketDisconnect("sock-host");

      vi.advanceTimersByTime(1000);
      expect(manager.getRoom(room.id)?.status).not.toBe("abandoned");
      vi.useRealTimers();
    });
  });
});
