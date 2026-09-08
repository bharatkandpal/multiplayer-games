// MPG-025: Setup → online-all-bot routing, end to end through the real App
// shell (not just the isolated hook/screen units covered elsewhere) — a
// customized all-bot seat config creates a "watch" room instead of the
// normal invite-link flow, and the creator's socket receives the game live.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ticTacToe } from "@mpg/engine";
import App from "./App";
import type { PublicRoom } from "./api/roomTypes.js";

type Handler = (...args: unknown[]) => void;

interface FakeSocket {
  connected: boolean;
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
    connect: vi.fn(() => {
      socket.connected = true;
    }),
    emit: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
    off: vi.fn((event: string) => handlers.delete(event)),
    handlers,
  };
  return socket;
}

let fakeSocket: FakeSocket;

vi.mock("./api/socket.js", () => ({
  getSocket: () => fakeSocket,
  connectSocket: () => fakeSocket,
  getConnectionState: () => (fakeSocket.connected ? "connected" : "disconnected"),
  onConnectionStateChange: () => () => undefined,
}));

function emit<T>(event: string, payload: T): void {
  fakeSocket.handlers.get(event)?.(payload);
}

function allBotRoom(overrides: Partial<PublicRoom> = {}): PublicRoom {
  return {
    roomId: "watch-room-1",
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

describe("App — Setup -> online all-bot -> watch routing (MPG-025)", () => {
  beforeEach(() => {
    fakeSocket = makeFakeSocket();
    window.localStorage.setItem(
      "mpg_username",
      JSON.stringify({ name: "tester", confirmed: true }),
    );
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.pushState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("configuring every seat as a bot and clicking the customize online action creates a watch room, not an invite", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Options for Tic-Tac-Toe/ }));
    fireEvent.click(screen.getByRole("button", { name: "Customize seats" }));

    const player1Group = screen.getByRole("radiogroup", { name: "Player 1 type" });
    fireEvent.click(within(player1Group).getByRole("radio", { name: "Bot" }));

    fireEvent.click(screen.getByRole("button", { name: /Watch online/i }));

    const room = allBotRoom();
    await waitFor(() =>
      expect(fakeSocket.emit).toHaveBeenCalledWith(
        "room:create",
        expect.objectContaining({
          gameId: "tictactoe",
          seats: [
            { slot: 1, kind: "bot", difficulty: "medium" },
            { slot: 2, kind: "bot", difficulty: "medium" },
          ],
        }),
        expect.any(Function),
      ),
    );

    const ackCall = fakeSocket.emit.mock.calls.find(([event]) => event === "room:create");
    const ack = ackCall?.[2] as (response: unknown) => void;
    act(() =>
      ack({
        ok: true,
        data: { room, roomId: room.roomId, creatorToken: "creator-tok-1" },
      }),
    );

    // Routed straight to the watch screen — no invite link, no "Rematch"
    // concept, and clearly labelled as watching, not playing.
    await waitFor(() =>
      expect(screen.getByText(/Watching — every seat is a bot/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/invite/i)).not.toBeInTheDocument();

    // The creator credential is persisted for a reload-recovery watch-rejoin.
    expect(window.sessionStorage.getItem(`mpg_creator_token:${room.roomId}`)).toBe("creator-tok-1");

    // Live game:update broadcasts render straight onto the board.
    const nextState = ticTacToe.applyMove(ticTacToe.createInitialState(), { cell: 0 }, 1);
    act(() =>
      emit("game:update", {
        room: { ...room, state: nextState, turn: 2 },
        lastMove: { slot: 1, move: { cell: 0 } },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: /Row 1, column 1, X/ })).toBeInTheDocument(),
    );
  });

  it("the primary 'Play online' button is unaffected — still creates a normal invite-link room", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Options for Tic-Tac-Toe/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Play online/ }));

    await waitFor(() =>
      expect(fakeSocket.emit).toHaveBeenCalledWith(
        "room:create",
        expect.objectContaining({
          seats: [
            { slot: 1, kind: "human", self: true },
            { slot: 2, kind: "human", self: false },
          ],
        }),
        expect.any(Function),
      ),
    );
  });

  it("reload of a watch room's URL, with a persisted creatorToken, watch-rejoins instead of showing 'join'", async () => {
    // Simulates a hard reload: this tab already created (and persisted the
    // creator credential for) this room in an earlier page load, and is now
    // opening its own `/gameId/room/roomId` URL fresh.
    window.sessionStorage.setItem("mpg_creator_token:watch-room-2", "creator-tok-2");
    window.history.pushState({}, "", "/tictactoe/room/watch-room-2");

    render(<App />);

    // Straight to watch-rejoin — never the guest "join" flow.
    expect(screen.queryByText(/Joining/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fakeSocket.emit).toHaveBeenCalledWith(
        "room:state",
        { roomId: "watch-room-2", creatorToken: "creator-tok-2" },
        expect.any(Function),
      ),
    );

    const room = allBotRoom({ roomId: "watch-room-2" });
    const ackCall = fakeSocket.emit.mock.calls.find(([event]) => event === "room:state");
    const ack = ackCall?.[2] as (response: unknown) => void;
    act(() => ack({ ok: true, data: { room } }));

    await waitFor(() =>
      expect(screen.getByText(/Watching — every seat is a bot/i)).toBeInTheDocument(),
    );
  });
});
