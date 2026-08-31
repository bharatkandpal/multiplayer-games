import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

interface FakeSocket {
  connected: boolean;
  active: boolean;
  connect: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  handlers: Map<string, Handler>;
}

function makeFakeSocket(): FakeSocket {
  const handlers = new Map<string, Handler>();
  const socket: FakeSocket = {
    connected: false,
    active: false,
    connect: vi.fn(() => {
      socket.connected = true;
    }),
    emit: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
    off: vi.fn(),
    handlers,
  };
  return socket;
}

let fakeSocket: FakeSocket;

vi.mock("../../api/socket.js", () => ({
  getSocket: () => fakeSocket,
  connectSocket: () => fakeSocket,
  getConnectionState: () => (fakeSocket.connected ? "connected" : "disconnected"),
  onConnectionStateChange: () => () => undefined,
}));

describe("useRoom", () => {
  beforeEach(() => {
    fakeSocket = makeFakeSocket();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("createRoom resolves with the room and sets yourSlot/sessionToken", async () => {
    const { useRoom } = await import("../useRoom.js");
    const { result } = renderHook(() => useRoom());

    const publicRoom = {
      roomId: "room-1",
      gameId: "tictactoe",
      status: "waiting",
      turn: 1,
      state: {},
      seats: [
        { slot: 1, kind: "human", open: false, connected: true },
        { slot: 2, kind: "human", open: true, connected: false },
      ],
    };

    let resolved: unknown;
    await act(async () => {
      const promise = result.current.createRoom("tictactoe", [
        { slot: 1, kind: "human", self: true },
        { slot: 2, kind: "human" },
      ]);

      const ackCall = fakeSocket.emit.mock.calls.find(([event]) => event === "room:create");
      const ack = ackCall?.[2] as (response: unknown) => void;
      ack({
        ok: true,
        data: { room: publicRoom, roomId: "room-1", sessionToken: "tok-1", yourSlot: 1 },
      });

      resolved = await promise;
    });

    expect(resolved).toEqual(publicRoom);
    expect(result.current.room).toEqual(publicRoom);
    expect(result.current.yourSlot).toBe(1);
    expect(result.current.sessionToken).toBe("tok-1");
  });

  it("createRoom exposes and persists the creatorToken (MPG-025 watch-rejoin)", async () => {
    const { useRoom } = await import("../useRoom.js");
    const { result } = renderHook(() => useRoom());

    const publicRoom = {
      roomId: "watch-room-9",
      gameId: "tictactoe",
      status: "active",
      turn: 1,
      state: {},
      seats: [
        { slot: 1, kind: "bot", difficulty: "medium", open: false, connected: true },
        { slot: 2, kind: "bot", difficulty: "hard", open: false, connected: true },
      ],
    };

    await act(async () => {
      const promise = result.current.createRoom("tictactoe", [
        { slot: 1, kind: "bot", difficulty: "medium" },
        { slot: 2, kind: "bot", difficulty: "hard" },
      ]);

      const ackCall = fakeSocket.emit.mock.calls.find(([event]) => event === "room:create");
      const ack = ackCall?.[2] as (response: unknown) => void;
      ack({
        ok: true,
        data: { room: publicRoom, roomId: "watch-room-9", creatorToken: "creator-tok-9" },
      });

      await promise;
    });

    expect(result.current.creatorToken).toBe("creator-tok-9");
    expect(window.sessionStorage.getItem("mpg_creator_token:watch-room-9")).toBe("creator-tok-9");
  });

  it("joinRoom resolves with the room on success", async () => {
    const { useRoom } = await import("../useRoom.js");
    const { result } = renderHook(() => useRoom());

    const publicRoom = {
      roomId: "room-2",
      gameId: "connect4",
      status: "active",
      turn: 1,
      state: {},
      seats: [
        { slot: 1, kind: "human", open: false, connected: true },
        { slot: 2, kind: "human", open: false, connected: true },
      ],
    };

    let resolved: unknown;
    await act(async () => {
      const promise = result.current.joinRoom("room-2");

      const ackCall = fakeSocket.emit.mock.calls.find(([event]) => event === "room:join");
      const ack = ackCall?.[2] as (response: unknown) => void;
      ack({ ok: true, data: { room: publicRoom, yourSlot: 2, sessionToken: "tok-2" } });

      resolved = await promise;
    });

    expect(resolved).toEqual(publicRoom);
    expect(result.current.room).toEqual(publicRoom);
    expect(result.current.yourSlot).toBe(2);
  });

  it("joinRoom sets `error` and resolves undefined on failure", async () => {
    const { useRoom } = await import("../useRoom.js");
    const { result } = renderHook(() => useRoom());

    let resolved: unknown = "unset";
    await act(async () => {
      const promise = result.current.joinRoom("bad-room");

      const ackCall = fakeSocket.emit.mock.calls.find(([event]) => event === "room:join");
      const ack = ackCall?.[2] as (response: unknown) => void;
      ack({ ok: false, error: { code: "NOT_FOUND", message: "Room not found" } });

      resolved = await promise;
    });

    expect(resolved).toBeUndefined();
    expect(result.current.error).toEqual({ code: "NOT_FOUND", message: "Room not found" });
  });

  it("tracks room state as `room:updated` broadcasts arrive", async () => {
    const { useRoom } = await import("../useRoom.js");
    const { result } = renderHook(() => useRoom());

    const updated = {
      roomId: "room-3",
      gameId: "tictactoe",
      status: "active",
      turn: 2,
      state: {},
      seats: [],
    };

    act(() => {
      fakeSocket.handlers.get("room:updated")?.({ room: updated });
    });

    await waitFor(() => expect(result.current.room).toEqual(updated));
  });

  it("surfaces `room:error` broadcasts", async () => {
    const { useRoom } = await import("../useRoom.js");
    const { result } = renderHook(() => useRoom());

    act(() => {
      fakeSocket.handlers.get("room:error")?.({ code: "ROOM_FULL", message: "Room is full" });
    });

    await waitFor(() =>
      expect(result.current.error).toEqual({ code: "ROOM_FULL", message: "Room is full" }),
    );

    act(() => result.current.clearError());
    expect(result.current.error).toBeUndefined();
  });
});
