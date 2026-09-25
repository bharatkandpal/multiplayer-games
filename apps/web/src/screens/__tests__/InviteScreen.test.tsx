import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteScreen } from "../InviteScreen";

describe("InviteScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the waiting state and the invite link", () => {
    render(
      <InviteScreen
        gameId="tictactoe"
        inviteUrl="http://localhost/tictactoe/room/room-1#s=secret"
        peerConnected={false}
        unavailable={false}
        onReady={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Waiting for opponent…")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("http://localhost/tictactoe/room/room-1#s=secret"),
    ).toBeInTheDocument();
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
        inviteUrl="http://localhost/tictactoe/room/room-1"
        peerConnected={false}
        unavailable={false}
        onReady={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByText("Link copied!")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("http://localhost/tictactoe/room/room-1");
  });

  it("uses the native share sheet when the platform has one (MPG-087)", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });

    render(
      <InviteScreen
        gameId="tictactoe"
        inviteUrl="http://localhost/tictactoe/room/room-1"
        peerConnected={false}
        unavailable={false}
        onReady={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // The label follows the capability, so it never promises a sheet that
    // won't open.
    await user.click(screen.getByRole("button", { name: "Share link" }));

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://localhost/tictactoe/room/room-1" }),
    );
    expect(await screen.findByText("Link shared!")).toBeInTheDocument();

    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "share");
  });

  it("calls onReady once the peer's presence is seen", async () => {
    const onReady = vi.fn();
    const { rerender } = render(
      <InviteScreen
        gameId="tictactoe"
        inviteUrl="http://localhost/tictactoe/room/room-1"
        peerConnected={false}
        unavailable={false}
        onReady={onReady}
        onCancel={vi.fn()}
      />,
    );

    expect(onReady).not.toHaveBeenCalled();

    rerender(
      <InviteScreen
        gameId="tictactoe"
        inviteUrl="http://localhost/tictactoe/room/room-1"
        peerConnected={true}
        unavailable={false}
        onReady={onReady}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => expect(onReady).toHaveBeenCalled());
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <InviteScreen
        gameId="tictactoe"
        inviteUrl="http://localhost/tictactoe/room/room-1"
        peerConnected={false}
        unavailable={false}
        onReady={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "← Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows an unavailable state with a way out instead of a dead-end", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <InviteScreen
        gameId="tictactoe"
        inviteUrl="http://localhost/tictactoe/room/room-1"
        peerConnected={false}
        unavailable={true}
        onReady={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Online play isn't available right now.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Back" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
