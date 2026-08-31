import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ticTacToe } from "@mpg/engine";
import type { PublicRoom } from "../../api/roomTypes.js";
import { TicTacToeWatchRoute } from "../games";

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
    on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
    off: vi.fn((event: string) => handlers.delete(event)),
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

describe("WatchGamePlayScreen — via TicTacToeWatchRoute", () => {
  beforeEach(() => {
    fakeSocket = makeFakeSocket();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a connecting state with no initial room", () => {
    render(
      <TicTacToeWatchRoute
        roomId="room-1"
        creatorToken="ctok-1"
        initialRoom={undefined}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByText(/Connecting to the game/i)).toBeInTheDocument();
  });

  it("renders a live all-bot game from the initial room, board read-only", async () => {
    render(
      <TicTacToeWatchRoute
        roomId="room-1"
        creatorToken="ctok-1"
        initialRoom={makeRoom()}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByText(/every seat is a bot/i)).toBeInTheDocument();
    expect(screen.getAllByText(/'s turn/).length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));
    // Read-only: clicking never sends a move.
    expect(fakeSocket.emit).not.toHaveBeenCalledWith("move", expect.anything());
  });

  it("applies opponent-free game:update broadcasts as the game plays out", async () => {
    render(
      <TicTacToeWatchRoute
        roomId="room-1"
        creatorToken="ctok-1"
        initialRoom={makeRoom()}
        onExit={vi.fn()}
      />,
    );

    const nextState = ticTacToe.applyMove(ticTacToe.createInitialState(), { cell: 4 }, 1);
    act(() =>
      emit("game:update", {
        room: makeRoom({ state: nextState, turn: 2 }),
        lastMove: { slot: 1, move: { cell: 4 } },
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: /Row 2, column 2, X/ })).toBeInTheDocument(),
    );
  });

  it("shows the result and no Rematch button on game:over — only Home", async () => {
    const onExit = vi.fn();
    render(
      <TicTacToeWatchRoute
        roomId="room-1"
        creatorToken="ctok-1"
        initialRoom={makeRoom()}
        onExit={onExit}
      />,
    );

    const winResult = { status: "win" as const, winner: 1 as const, line: [0, 1, 2] as const };
    act(() =>
      emit("game:over", {
        room: makeRoom(),
        result: winResult,
      }),
    );

    await waitFor(() => expect(screen.queryByText(/Connecting/i)).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Rematch/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(onExit).toHaveBeenCalled();
  });

  it("requests a room:state watch-rejoin with the creatorToken when there's no live snapshot", () => {
    render(
      <TicTacToeWatchRoute
        roomId="room-1"
        creatorToken="ctok-1"
        initialRoom={undefined}
        onExit={vi.fn()}
      />,
    );

    expect(fakeSocket.emit).toHaveBeenCalledWith(
      "room:state",
      { roomId: "room-1", creatorToken: "ctok-1" },
      expect.any(Function),
    );
  });
});
