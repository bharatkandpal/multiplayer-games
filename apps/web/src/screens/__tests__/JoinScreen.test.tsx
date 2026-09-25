import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JoinScreen } from "../JoinScreen";

describe("JoinScreen", () => {
  it("starts joining and hands off to the game screen immediately", () => {
    const joinRoom = vi.fn();
    const onJoined = vi.fn();

    render(
      <JoinScreen
        gameId="tictactoe"
        roomId="room-1"
        secret="s3cret"
        joinRoom={joinRoom}
        onJoined={onJoined}
        onBackHome={vi.fn()}
      />,
    );

    expect(joinRoom).toHaveBeenCalledWith("room-1", "s3cret");
    expect(onJoined).toHaveBeenCalled();
  });

  it("shows a friendly error and a way home for a link with no secret", async () => {
    const joinRoom = vi.fn();
    const onBackHome = vi.fn();
    const user = userEvent.setup();

    render(
      <JoinScreen
        gameId="tictactoe"
        roomId="room-1"
        secret={undefined}
        joinRoom={joinRoom}
        onJoined={vi.fn()}
        onBackHome={onBackHome}
      />,
    );

    expect(joinRoom).not.toHaveBeenCalled();
    expect(
      screen.getByText("This invite link is missing its secret — ask for a fresh one."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← Back to home" }));
    expect(onBackHome).toHaveBeenCalled();
  });
});
