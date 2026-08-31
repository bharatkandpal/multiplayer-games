import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ticTacToe } from "@mpg/engine";
import type { PublicRoom } from "../../api/roomTypes.js";

type Handler = (...args: unknown[]) => void;

interface FakeSocket {
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  handlers: Map<string, Handler>;
}

function makeFakeSocket(): FakeSocket {
  const handlers = new Map<string, Handler>();
  return {
    emit: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event);
    }),
    handlers,
  };
}

let fakeSocket: FakeSocket;

vi.mock("../../api/socket.js", () => ({
  getSocket: () => fakeSocket,
}));

function emit<T>(event: string, payload: T): void {
  fakeSocket.handlers.get(event)?.(payload);
}

function makeRoom(overrides: Partial<PublicRoom> = {}): PublicRoom {
  return {
    roomId: "room-1",
    gameId: "tictactoe",
    status: "active",
    turn: 1,
    state: ticTacToe.createInitialState(),
    seats: [
      { slot: 1, kind: "bot", difficulty: "medium", open: false, connected: true },
      { slot: 2, kind: "bot", difficulty: "hard", open: false, connected: true },
    ],
    ...overrides,
  };
}

describe("useWatchOnlinePlay", () => {
  beforeEach(() => {
    fakeSocket = makeFakeSocket();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes immediately from an already-active initialRoom, seats derived from it", async () => {
    const { useWatchOnlinePlay } = await import("../useWatchOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useWatchOnlinePlay({
        game: ticTacToe,
        roomId: "room-1",
        creatorToken: "ctok-1",
        initialRoom: room,
      }),
    );

    expect(result.current.phase).toBe("watching");
    expect(result.current.state).toEqual(room.state);
    expect(result.current.seats).toEqual([
      { kind: "bot", difficulty: "medium" },
      { kind: "bot", difficulty: "hard" },
    ]);
  });

  it("starts 'connecting' with no initialRoom and requests room:state with the creatorToken", async () => {
    const { useWatchOnlinePlay } = await import("../useWatchOnlinePlay.js");
    const { result } = renderHook(() =>
      useWatchOnlinePlay({ game: ticTacToe, roomId: "room-1", creatorToken: "ctok-1" }),
    );

    expect(result.current.phase).toBe("connecting");
    expect(fakeSocket.emit).toHaveBeenCalledWith(
      "room:state",
      { roomId: "room-1", creatorToken: "ctok-1" },
      expect.any(Function),
    );

    const room = makeRoom();
    const ackCall = fakeSocket.emit.mock.calls.find(([event]) => event === "room:state");
    const ack = ackCall?.[2] as (response: unknown) => void;
    act(() => ack({ ok: true, data: { room } }));

    await waitFor(() => expect(result.current.phase).toBe("watching"));
    expect(result.current.seats).toEqual([
      { kind: "bot", difficulty: "medium" },
      { kind: "bot", difficulty: "hard" },
    ]);
  });

  it("game:update reconciles state and appends to moveLog, paced move by move", async () => {
    const { useWatchOnlinePlay } = await import("../useWatchOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useWatchOnlinePlay({
        game: ticTacToe,
        roomId: "room-1",
        creatorToken: "ctok-1",
        initialRoom: room,
      }),
    );

    const nextState = ticTacToe.applyMove(ticTacToe.createInitialState(), { cell: 0 }, 1);
    act(() =>
      emit("game:update", {
        room: makeRoom({ state: nextState, turn: 2 }),
        lastMove: { slot: 1, move: { cell: 0 } },
      }),
    );

    await waitFor(() => expect(result.current.state).toEqual(nextState));
    expect(result.current.turn).toBe(2);
    expect(result.current.moveLog).toEqual([{ move: { cell: 0 }, player: 1 }]);
  });

  it("game:over sets result and phase='finished'", async () => {
    const { useWatchOnlinePlay } = await import("../useWatchOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useWatchOnlinePlay({
        game: ticTacToe,
        roomId: "room-1",
        creatorToken: "ctok-1",
        initialRoom: room,
      }),
    );

    const winResult = { status: "win" as const, winner: 1 as const, line: [0, 1, 2] };
    act(() =>
      emit("game:over", {
        room: makeRoom({ state: room.state }),
        result: winResult,
      }),
    );

    await waitFor(() => expect(result.current.phase).toBe("finished"));
  });

  it("ignores game:update events for a different room", async () => {
    const { useWatchOnlinePlay } = await import("../useWatchOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useWatchOnlinePlay({
        game: ticTacToe,
        roomId: "room-1",
        creatorToken: "ctok-1",
        initialRoom: room,
      }),
    );

    const otherState = ticTacToe.applyMove(ticTacToe.createInitialState(), { cell: 4 }, 1);
    act(() =>
      emit("game:update", {
        room: makeRoom({ roomId: "room-2", state: otherState }),
        lastMove: { slot: 1, move: { cell: 4 } },
      }),
    );

    expect(result.current.state).toEqual(room.state);
  });
});
