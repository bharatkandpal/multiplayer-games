import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteScreen } from "../InviteScreen";
import type { PublicRoom } from "../../api/roomTypes";

const waitingRoom: PublicRoom = {
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

const activeRoom: PublicRoom = {
  ...waitingRoom,
  status: "active",
  seats: [
    { slot: 1, kind: "human", open: false, connected: true },
    { slot: 2, kind: "human", open: false, connected: true },
  ],
};

describe("InviteScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the waiting state and the invite link", () => {
    render(
      <InviteScreen
        gameId="tictactoe"
        room={waitingRoom}
        inviteUrl="http://localhost/tictactoe/room/room-1"
        onReady={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Waiting for opponent…")).toBeInTheDocument();
    expect(screen.getByDisplayValue("http://localhost/tictactoe/room/room-1")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 seats filled")).toBeInTheDocument();
  });

  it("copies the invite link and shows confirmation feedback", async () => {
    // @testing-library/user-event installs its own `navigator.clipboard` stub
    // on setup() — spy on its `writeText` rather than replacing `navigator`
    // wholesale (which user-event would otherwise clobber).
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    render(
      <InviteScreen
        gameId="tictactoe"
        room={waitingRoom}
        inviteUrl="http://localhost/tictactoe/room/room-1"
        onReady={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByText("Link copied!")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("http://localhost/tictactoe/room/room-1");
  });

  it("calls onReady once the room becomes active", async () => {
    const onReady = vi.fn();
    const { rerender } = render(
      <InviteScreen
        gameId="tictactoe"
        room={waitingRoom}
        inviteUrl="http://localhost/tictactoe/room/room-1"
        onReady={onReady}
        onCancel={vi.fn()}
      />,
    );

    expect(onReady).not.toHaveBeenCalled();

    rerender(
      <InviteScreen
        gameId="tictactoe"
        room={activeRoom}
        inviteUrl="http://localhost/tictactoe/room/room-1"
        onReady={onReady}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => expect(onReady).toHaveBeenCalledWith(activeRoom));
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <InviteScreen
        gameId="tictactoe"
        room={waitingRoom}
        inviteUrl="http://localhost/tictactoe/room/room-1"
        onReady={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "← Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
