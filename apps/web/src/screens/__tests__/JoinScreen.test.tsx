import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JoinScreen } from "../JoinScreen";
import type { PublicRoom } from "../../api/roomTypes";

const room: PublicRoom = {
  roomId: "room-1",
  gameId: "tictactoe",
  status: "active",
  turn: 1,
  state: {},
  seats: [
    { slot: 1, kind: "human", open: false, connected: true },
    { slot: 2, kind: "human", open: false, connected: true },
  ],
};

describe("JoinScreen", () => {
  it("shows a joining state, then calls onJoined on success", async () => {
    const joinRoom = vi.fn().mockResolvedValue(room);
    const onJoined = vi.fn();

    render(
      <JoinScreen
        gameId="tictactoe"
        roomId="room-1"
        joinRoom={joinRoom}
        error={undefined}
        onJoined={onJoined}
        onBackHome={vi.fn()}
      />,
    );

    expect(screen.getByText("Joining room…")).toBeInTheDocument();
    expect(joinRoom).toHaveBeenCalledWith("room-1");

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(room));
  });

  it("shows a friendly error and a way home when the room is full", async () => {
    const joinRoom = vi.fn().mockResolvedValue(undefined);
    const onBackHome = vi.fn();
    const user = userEvent.setup();

    render(
      <JoinScreen
        gameId="tictactoe"
        roomId="room-1"
        joinRoom={joinRoom}
        error={{ code: "ROOM_FULL", message: "No open human seats in this room" }}
        onJoined={vi.fn()}
        onBackHome={onBackHome}
      />,
    );

    expect(await screen.findByText("This room is already full.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← Back to home" }));
    expect(onBackHome).toHaveBeenCalled();
  });

  it("shows a friendly error when the room is not found", async () => {
    const joinRoom = vi.fn().mockResolvedValue(undefined);

    render(
      <JoinScreen
        gameId="tictactoe"
        roomId="expired-room"
        joinRoom={joinRoom}
        error={{ code: "NOT_FOUND", message: "Room not found: expired-room" }}
        onJoined={vi.fn()}
        onBackHome={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("This invite link has expired or the room no longer exists."),
    ).toBeInTheDocument();
  });
});
