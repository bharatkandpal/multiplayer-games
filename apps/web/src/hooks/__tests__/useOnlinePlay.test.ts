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
      { slot: 1, kind: "human", open: false, connected: true },
      { slot: 2, kind: "human", open: false, connected: true },
    ],
    ...overrides,
  };
}

describe("useOnlinePlay", () => {
  beforeEach(() => {
    fakeSocket = makeFakeSocket();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in 'waiting' with no initialRoom, and flips to 'playing' on game:start", async () => {
    const { useOnlinePlay } = await import("../useOnlinePlay.js");
    const { result } = renderHook(() =>
      useOnlinePlay({ game: ticTacToe, roomId: "room-1", yourSlot: 1 }),
    );

    expect(result.current.phase).toBe("waiting");

    const room = makeRoom();
    act(() => emit("game:start", { room }));

    await waitFor(() => expect(result.current.phase).toBe("playing"));
    expect(result.current.state).toEqual(room.state);
    expect(result.current.turn).toBe(1);
  });

  it("initializes immediately from an already-active initialRoom", async () => {
    const { useOnlinePlay } = await import("../useOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useOnlinePlay({ game: ticTacToe, roomId: "room-1", yourSlot: 1, initialRoom: room }),
    );

    expect(result.current.phase).toBe("playing");
    expect(result.current.state).toEqual(room.state);
    expect(result.current.yourTurn).toBe(true);
  });

  it("makeMove emits a 'move' socket event and applies the move optimistically", async () => {
    const { useOnlinePlay } = await import("../useOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useOnlinePlay({ game: ticTacToe, roomId: "room-1", yourSlot: 1, initialRoom: room }),
    );

    act(() => result.current.makeMove({ cell: 0 }));

    expect(fakeSocket.emit).toHaveBeenCalledWith("move", { roomId: "room-1", move: { cell: 0 } });
    // Optimistic: the board already reflects the move before any server reply.
    await waitFor(() => {
      const state = result.current.state as { board: (number | null)[] };
      expect(state.board[0]).toBe(1);
    });
  });

  it("makeMove is a no-op when it isn't your turn", async () => {
    const { useOnlinePlay } = await import("../useOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useOnlinePlay({ game: ticTacToe, roomId: "room-1", yourSlot: 2, initialRoom: room }),
    );

    expect(result.current.yourTurn).toBe(false);
    act(() => result.current.makeMove({ cell: 0 }));
    expect(fakeSocket.emit).not.toHaveBeenCalled();
  });

  it("game:update reconciles state and appends to moveLog", async () => {
    const { useOnlinePlay } = await import("../useOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useOnlinePlay({ game: ticTacToe, roomId: "room-1", yourSlot: 1, initialRoom: room }),
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
    const { useOnlinePlay } = await import("../useOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useOnlinePlay({ game: ticTacToe, roomId: "room-1", yourSlot: 1, initialRoom: room }),
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

  it("move:rejected reverts to the last authoritative state with a friendly message", async () => {
    const { useOnlinePlay } = await import("../useOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useOnlinePlay({ game: ticTacToe, roomId: "room-1", yourSlot: 1, initialRoom: room }),
    );

    act(() => result.current.makeMove({ cell: 0 }));
    await waitFor(() => {
      const state = result.current.state as { board: (number | null)[] };
      expect(state.board[0]).toBe(1);
    });

    act(() => emit("move:rejected", { reason: "ILLEGAL_MOVE" }));

    await waitFor(() => expect(result.current.error).toBeTruthy());
    const state = result.current.state as { board: (number | null)[] };
    expect(state.board[0]).toBeNull();
  });

  it("tracks opponent disconnect/reconnect indicators", async () => {
    const { useOnlinePlay } = await import("../useOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useOnlinePlay({ game: ticTacToe, roomId: "room-1", yourSlot: 1, initialRoom: room }),
    );

    expect(result.current.opponentDisconnected).toBe(false);

    act(() => emit("opponent:disconnected", { graceMs: 30000 }));
    await waitFor(() => expect(result.current.opponentDisconnected).toBe(true));

    act(() => emit("opponent:reconnected", {}));
    await waitFor(() => expect(result.current.opponentDisconnected).toBe(false));
  });

  it("tracks room:abandoned", async () => {
    const { useOnlinePlay } = await import("../useOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useOnlinePlay({ game: ticTacToe, roomId: "room-1", yourSlot: 1, initialRoom: room }),
    );

    act(() => emit("room:abandoned", { reason: "opponent-left" }));

    await waitFor(() => expect(result.current.roomAbandoned).toBe(true));
    expect(result.current.roomAbandonReason).toBe("opponent-left");
  });

  it("ignores game:update events for a different room", async () => {
    const { useOnlinePlay } = await import("../useOnlinePlay.js");
    const room = makeRoom();
    const { result } = renderHook(() =>
      useOnlinePlay({ game: ticTacToe, roomId: "room-1", yourSlot: 1, initialRoom: room }),
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
