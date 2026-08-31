import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ticTacToe } from "@mpg/engine";
import type { PublicRoom } from "../../api/roomTypes.js";
import { TicTacToeOnlineRoute } from "../games";

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
      { slot: 1, kind: "human", open: false, connected: true },
      { slot: 2, kind: "human", open: false, connected: true },
    ],
    ...overrides,
  };
}

describe("OnlineGamePlayScreen — via TicTacToeOnlineRoute", () => {
  beforeEach(() => {
    fakeSocket = makeFakeSocket();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the board from socket state and sends a move on click", async () => {
    const user = userEvent.setup();
    const room = makeRoom();

    render(
      <TicTacToeOnlineRoute
        seats={[{ kind: "human" }, { kind: "human" }]}
        roomId="room-1"
        yourSlot={1}
        sessionToken="tok-1"
        initialRoom={room}
        onExit={vi.fn()}
        onRematchStart={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Player 1's turn").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));

    expect(fakeSocket.emit).toHaveBeenCalledWith("move", {
      roomId: "room-1",
      move: { cell: 0 },
    });
    // Optimistic: the cell already shows X before any server reply.
    expect(screen.getByRole("gridcell", { name: /Row 1, column 1, X/ })).toBeInTheDocument();
  });

  it("shows the opponent's move on game:update without any local click", async () => {
    render(
      <TicTacToeOnlineRoute
        seats={[{ kind: "human" }, { kind: "human" }]}
        roomId="room-1"
        yourSlot={2}
        sessionToken="tok-2"
        initialRoom={room2()}
        onExit={vi.fn()}
        onRematchStart={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/'s turn/).length).toBeGreaterThan(0);

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
    expect(screen.getAllByText("Player 2's turn").length).toBeGreaterThan(0);
  });

  it("shows an 'opponent disconnected' banner and clears it on reconnect", async () => {
    render(
      <TicTacToeOnlineRoute
        seats={[{ kind: "human" }, { kind: "human" }]}
        roomId="room-1"
        yourSlot={1}
        sessionToken="tok-1"
        initialRoom={makeRoom()}
        onExit={vi.fn()}
        onRematchStart={vi.fn()}
      />,
    );

    act(() => emit("opponent:disconnected", { graceMs: 30000 }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for them to reconnect/i)).toBeInTheDocument(),
    );

    act(() => emit("opponent:reconnected", {}));
    await waitFor(() =>
      expect(screen.queryByText(/waiting for them to reconnect/i)).not.toBeInTheDocument(),
    );
  });

  it("shows a 'back to home' screen on room:abandoned", async () => {
    const onExit = vi.fn();
    render(
      <TicTacToeOnlineRoute
        seats={[{ kind: "human" }, { kind: "human" }]}
        roomId="room-1"
        yourSlot={1}
        sessionToken="tok-1"
        initialRoom={makeRoom()}
        onExit={onExit}
        onRematchStart={vi.fn()}
      />,
    );

    act(() => emit("room:abandoned", { reason: "opponent-left" }));

    await waitFor(() => expect(screen.getByText(/left the game/i)).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /back to home/i }));
    expect(onExit).toHaveBeenCalled();
  });
});

function room2(): PublicRoom {
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
  };
}
