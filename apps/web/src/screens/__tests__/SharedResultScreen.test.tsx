import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SharedResultScreen } from "../SharedResultScreen";
import { DeadShareLinkError, fetchSharedView } from "../../api/share";

vi.mock("../../api/share", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/share")>();
  return { ...actual, fetchSharedView: vi.fn() };
});

const RESULT_VIEW = {
  kind: "result" as const,
  result: {
    gameId: "floppy-birds",
    gameFamily: "realtime",
    status: "complete",
    score: 42,
    winnerSlot: null,
    seatsSnapshot: null,
    durationMs: null,
    createdAt: "2026-09-09T00:00:00.000Z",
  },
};

function renderScreen(overrides: Partial<Parameters<typeof SharedResultScreen>[0]> = {}) {
  const props = {
    token: "tok-1",
    onPlayGame: vi.fn(),
    onBackHome: vi.fn(),
    onViewLeaderboard: vi.fn(),
    ...overrides,
  };
  render(<SharedResultScreen {...props} />);
  return props;
}

describe("SharedResultScreen (MPG-056)", () => {
  beforeEach(() => {
    vi.mocked(fetchSharedView).mockReset();
  });

  it("LOADING: shows a labelled skeleton, never a bare spinner", () => {
    vi.mocked(fetchSharedView).mockReturnValue(new Promise(() => {}));
    renderScreen();

    // Announced once via the group's live region, not as per-shape noise.
    expect(screen.getByRole("status")).toHaveTextContent("Loading shared result…");
  });

  it("READY: a scored result offers BEATING it as the primary action (MPG-087)", async () => {
    vi.mocked(fetchSharedView).mockResolvedValue(RESULT_VIEW);
    const props = renderScreen();

    expect(await screen.findByText("Scored 42")).toBeInTheDocument();
    expect(screen.getByText("Floppy Birds")).toBeInTheDocument();

    // A scored (real-time) result turns the shared link into a challenge: the
    // primary action drops the visitor into the game with this score to beat,
    // not merely to admire someone else's number.
    await userEvent.click(screen.getByRole("button", { name: "Beat this score" }));
    expect(props.onPlayGame).toHaveBeenCalledWith("floppy-birds", 42);
  });

  it("READY: a turn-based result with no score states the outcome instead", async () => {
    vi.mocked(fetchSharedView).mockResolvedValue({
      kind: "result",
      // The shape a turn-based row actually has: the engine's own terminal
      // status, and a 1-BASED winner slot (`Player`). Naming the winner
      // "Player 2" here would be the off-by-one MPG-131 fixed — the seat the
      // player saw win was seat 1.
      result: {
        ...RESULT_VIEW.result,
        gameId: "connect4",
        status: "win",
        score: null,
        winnerSlot: 1,
      },
    });
    renderScreen();

    expect(await screen.findByText("Player 1 won")).toBeInTheDocument();
  });

  it("READY: a draw reads as a draw, not as 'Player 1 won'", async () => {
    vi.mocked(fetchSharedView).mockResolvedValue({
      kind: "result",
      result: { ...RESULT_VIEW.result, gameId: "connect4", score: null, winnerSlot: null },
    });
    renderScreen();

    expect(await screen.findByText("Ended in a draw")).toBeInTheDocument();
  });

  it("DEAD LINK: explains it plainly and still ends in a way into a game", async () => {
    vi.mocked(fetchSharedView).mockRejectedValue(new DeadShareLinkError());
    const props = renderScreen();

    expect(await screen.findByText("Link no longer works")).toBeInTheDocument();
    // Plain language, no status codes, no blame.
    expect(screen.getByText(/may have expired or been removed/)).toBeInTheDocument();
    // No "Try again" — retrying a revoked link never works, so offering it lies.
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Browse games" }));
    expect(props.onBackHome).toHaveBeenCalled();
  });

  it("ERROR: a network failure IS retryable, and retrying re-fetches", async () => {
    vi.mocked(fetchSharedView).mockRejectedValueOnce(new Error("offline"));
    renderScreen();

    expect(await screen.findByText("Couldn't load this shared result.")).toBeInTheDocument();

    vi.mocked(fetchSharedView).mockResolvedValueOnce(RESULT_VIEW);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Scored 42")).toBeInTheDocument();
    await waitFor(() => expect(fetchSharedView).toHaveBeenCalledTimes(2));
  });

  it("LEADERBOARD LINK: resolves to the board, with a way to play the game too", async () => {
    vi.mocked(fetchSharedView).mockResolvedValue({
      kind: "leaderboard",
      gameId: "floppy-birds",
      eventId: null,
    });
    const props = renderScreen();

    await userEvent.click(await screen.findByRole("button", { name: "View leaderboard" }));
    expect(props.onViewLeaderboard).toHaveBeenCalledWith("floppy-birds");

    await userEvent.click(screen.getByRole("button", { name: /Play Floppy Birds/ }));
    expect(props.onPlayGame).toHaveBeenCalledWith("floppy-birds");
  });

  it("falls back to the raw game id for a game this build doesn't know", async () => {
    vi.mocked(fetchSharedView).mockResolvedValue({
      kind: "result",
      result: { ...RESULT_VIEW.result, gameId: "some-future-game" },
    });
    renderScreen();

    expect(await screen.findByText("some-future-game")).toBeInTheDocument();
  });
});
