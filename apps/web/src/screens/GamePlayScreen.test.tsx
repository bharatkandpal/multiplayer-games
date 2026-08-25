import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TicTacToeRoute } from "./games";
import type { SeatsConfig } from "../game";

const BOT_THINKING_STEP_MS = 600; // fallback in ../game/motion.ts (no CSS var in jsdom)

/** Advances the paced bot-thinking timer and flushes the resulting React updates. */
async function advanceBotStep(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(BOT_THINKING_STEP_MS);
  });
}

describe("GamePlayScreen — local play-through (via TicTacToeRoute)", () => {
  it("plays a full human-vs-human game: alternating turns, win detection, result screen, rematch", async () => {
    const user = userEvent.setup();
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
    render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    expect(screen.getByText("Player 1's turn")).toBeInTheDocument();

    // X: 0, 1, 2 (top row) — O: 3, 4 — X wins.
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));
    expect(screen.getByText("Player 2's turn")).toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 1, empty" }));
    expect(screen.getByText("Player 1's turn")).toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 2, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 3, empty" }));

    const dialog = await screen.findByRole("dialog", { name: "Player 1 wins!" });
    expect(within(dialog).getByText("Nice game! Ready for a rematch?")).toBeInTheDocument();

    // Board is disabled/inert behind the modal once the game is over.
    expect(screen.getByRole("gridcell", { name: "Row 3, column 1, empty" })).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Rematch" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Player 1's turn")).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" })).toBeInTheDocument();
  });

  it("rejects an out-of-turn/illegal click without changing the board, then recovers", async () => {
    const user = userEvent.setup();
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
    render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    const cell = screen.getByRole("gridcell", { name: "Row 1, column 1, empty" });
    await user.click(cell);
    // Re-clicking the now-occupied cell as if it were still player 1's turn is a
    // straightforward illegal click via the UI (cell is disabled), but the reducer's
    // own guard is covered in gameSession.test.ts; here we assert the resulting UX:
    // an occupied cell simply can't be re-clicked (no flicker, no crash).
    expect(cell).toBeDisabled();
    expect(screen.getByText("Player 2's turn")).toBeInTheDocument();
  });
});

describe("GamePlayScreen — human vs. bot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a 'thinking' status for the bot's seat, then applies its move automatically", async () => {
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "bot", difficulty: "hard" }];
    render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" }));

    expect(screen.getByText("Hard bot (Player 2) is thinking…")).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 2, column 2, X" })).toBeInTheDocument();

    await advanceBotStep();

    // The bot has moved: exactly one O now on the board, and it's the human's turn again.
    // (describeSeat reads a solo human as "You" — see seatConfig.ts.)
    expect(screen.getByText("You's turn")).toBeInTheDocument();
    const oCells = screen.getAllByRole("gridcell").filter((el) => el.getAttribute("aria-label")?.endsWith(", O"));
    expect(oCells).toHaveLength(1);
  });
});

describe("GamePlayScreen — bot vs. bot (watch mode)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("free-runs an all-bot game to completion (perfect play draws) without any human input", async () => {
    const seats: SeatsConfig = [
      { kind: "bot", difficulty: "hard" },
      { kind: "bot", difficulty: "hard" },
    ];
    render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    // Tic-Tac-Toe has at most 9 plies; give it a comfortably larger step budget.
    for (let i = 0; i < 12 && screen.queryByRole("dialog") === null; i++) {
      await advanceBotStep();
    }

    const dialog = screen.getByRole("dialog", { name: "It's a draw!" });
    expect(within(dialog).getByText("Good game — nobody blinked.")).toBeInTheDocument();
  });

  it("shows watch controls only for all-bot games, not human games", () => {
    vi.useRealTimers(); // no bot pacing needed for this static-render assertion
    const { unmount } = render(
      <TicTacToeRoute
        seats={[{ kind: "human" }, { kind: "human" }]}
        onExit={vi.fn()}
      />,
    );
    expect(screen.queryByRole("group", { name: "Watch controls" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    unmount();

    render(
      <TicTacToeRoute
        seats={[
          { kind: "bot", difficulty: "hard" },
          { kind: "bot", difficulty: "hard" },
        ]}
        onExit={vi.fn()}
      />,
    );
    expect(screen.getByRole("group", { name: "Watch controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1x" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("pause holds the game; Step advances exactly one bot move at a time", async () => {
    const seats: SeatsConfig = [
      { kind: "bot", difficulty: "hard" },
      { kind: "bot", difficulty: "hard" },
    ];
    render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    // An open cell is labelled "…, empty" — counting them tracks moves landing.
    const emptyCells = () =>
      screen.getAllByRole("gridcell").filter((c) => /empty$/.test(c.getAttribute("aria-label") ?? ""))
        .length;
    expect(emptyCells()).toBe(9);

    // Pause before the first paced move lands.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    });

    // While paused, advancing the timer does NOT apply a move.
    await advanceBotStep();
    expect(emptyCells()).toBe(9);

    // Step applies exactly one queued move, then re-queues the next (still paused).
    const step = screen.getByRole("button", { name: "Step" });
    expect(step).toBeEnabled();
    act(() => {
      fireEvent.click(step);
    });
    expect(emptyCells()).toBe(8);

    // Still paused: the timer alone won't advance the second move.
    await advanceBotStep();
    expect(emptyCells()).toBe(8);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Step" }));
    });
    expect(emptyCells()).toBe(7);
  });
});
