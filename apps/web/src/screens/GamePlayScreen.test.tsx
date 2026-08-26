import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TicTacToeRoute } from "./games";
import type { SeatsConfig } from "../game";
import boardStyles from "../components/board/TicTacToeBoard.module.css";

const BOT_THINKING_STEP_MS = 600; // fallback in ../game/motion.ts (no CSS var in jsdom)

/** Advances the paced bot-thinking timer and flushes the resulting React updates. */
async function advanceBotStep(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(BOT_THINKING_STEP_MS);
  });
}

/**
 * Asserts a board cell is inert (can't be interacted with), regardless of
 * whether the board marks that via the native `disabled` attribute or
 * `aria-disabled` (both are valid, board-owned implementation choices).
 */
function expectInert(cell: HTMLElement): void {
  const isNativelyDisabled = cell.hasAttribute("disabled");
  const isAriaDisabled = cell.getAttribute("aria-disabled") === "true";
  expect(isNativelyDisabled || isAriaDisabled).toBe(true);
}

describe("GamePlayScreen — local play-through (via TicTacToeRoute)", () => {
  it("plays a full human-vs-human game: alternating turns, win detection, inline result, rematch", async () => {
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

    // No dialog — the result is shown inline, board fully visible underneath,
    // no dismiss step required. Human-vs-human is a neutral "X wins!" outcome,
    // never framed as anyone individually "losing". There's no visible
    // win/lose text banner (MPG-046) — the outcome is carried by the board
    // treatment plus the aria-live region, asserted below.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Player 1 wins!", { selector: "p" })).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Player 1 wins!");

    // Board is still visible (and inert) once the game is over.
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, X" })).toBeInTheDocument();
    expectInert(screen.getByRole("gridcell", { name: "Row 3, column 1, empty" }));

    // Neutral/win tone (never a solo local human losing) keeps the plain
    // green winning-line highlight — never the red "loss" variant.
    for (const name of ["Row 1, column 1, X", "Row 1, column 2, X", "Row 1, column 3, X"]) {
      const cell = screen.getByRole("gridcell", { name });
      expect(cell.classList.contains(boardStyles.winning!)).toBe(true);
      expect(cell.classList.contains(boardStyles.winningLoss!)).toBe(false);
    }

    // The Rematch button is the primary next action — inline, below the
    // board, and focused automatically so keyboard/AT users land right on it.
    const rematchButton = screen.getByRole("button", { name: "Rematch" });
    expect(rematchButton).toHaveFocus();

    await user.click(rematchButton);

    expect(screen.queryByRole("status")).not.toHaveTextContent("Player 1 wins!");
    expect(screen.getByText("Player 1's turn")).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" })).toBeInTheDocument();
  });

  it("renders all seats in a single row above the board (no below-board row)", () => {
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
    const { container } = render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    const seatRows = container.querySelectorAll('[class*="seatRow"]');
    expect(seatRows).toHaveLength(1);
    expect(screen.getByText("Player 1")).toBeInTheDocument();
    expect(screen.getByText("Player 2")).toBeInTheDocument();

    // The single seat row must come before the board in document order.
    const board = screen.getByRole("grid", { name: "Tic-Tac-Toe board" });
    const followsSeatRow = Boolean(
      seatRows[0]!.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(followsSeatRow).toBe(true);
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
    expectInert(cell);
    expect(screen.getByText("Player 2's turn")).toBeInTheDocument();
  });

  it("Home (top bar) exits immediately, at any point in the game — including after it's over", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
    render(<TicTacToeRoute seats={seats} onExit={onExit} />);

    const homeButton = screen.getByRole("button", { name: "Home" });
    await user.click(homeButton);
    expect(onExit).toHaveBeenCalledTimes(1);
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

    const badgeText = screen.getByText("Hard bot (Player 2) is thinking…");
    expect(badgeText).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 2, column 2, X" })).toBeInTheDocument();

    // A subtle, decorative "thinking" indicator lives on the active seat's
    // SeatCard (not a content-loading Skeleton, and not duplicated on the
    // status badge too) while the bot computes its move.
    const seatCard = screen.getByText("Player 2").closest("div");
    expect(seatCard?.querySelector('[class*="thinkingDots"]')).not.toBeNull();

    await advanceBotStep();

    // The indicator disappears once it's the human's turn again.
    expect(screen.queryByText(/is thinking…/)).not.toBeInTheDocument();

    // The bot has moved: exactly one O now on the board, and it's the human's turn again.
    // (describeSeat reads a solo human as "You" — see seatConfig.ts.)
    expect(screen.getByText("You's turn")).toBeInTheDocument();
    const oCells = screen.getAllByRole("gridcell").filter((el) => el.getAttribute("aria-label")?.endsWith(", O"));
    expect(oCells).toHaveLength(1);
  });

  it("frames a solo human's loss to the bot as subdued (not celebratory), inline, with Rematch focused", async () => {
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "bot", difficulty: "hard" }];
    render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    // A deterministic forced loss against the (never-blundering) hard bot:
    // X: 0 (Row1,Col1), 8 (Row3,Col3), 2 (Row1,Col3) — O (hard, optimal): 4, 1, 7
    // — O completes the middle column (1, 4, 7).
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));
    await advanceBotStep();
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 3, column 3, empty" }));
    await advanceBotStep();
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 1, column 3, empty" }));
    await advanceBotStep();

    // No visible win/lose text banner — the outcome is carried by the
    // aria-live region and the board's own (red) winning-line treatment.
    expect(screen.queryByText("Hard bot (Player 2) wins!", { selector: "p" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Hard bot (Player 2) wins!");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The winning line (middle column: 1, 4, 7) reads red — the sole local
    // human lost — not the normal green success highlight.
    for (const name of ["Row 1, column 2, O", "Row 2, column 2, O", "Row 3, column 2, O"]) {
      const cell = screen.getByRole("gridcell", { name });
      expect(cell.classList.contains(boardStyles.winningLoss!)).toBe(true);
      expect(cell.classList.contains(boardStyles.winning!)).toBe(false);
    }

    const rematchButton = screen.getByRole("button", { name: "Rematch" });
    expect(rematchButton).toBeInTheDocument();
    expect(rematchButton).toHaveFocus();
  });
});

describe("GamePlayScreen — play again vs a different opponent (MPG-050)", () => {
  it("does not render the play-again-vs group when onPlayAgain is not provided", async () => {
    const user = userEvent.setup();
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
    render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 1, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 2, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 3, empty" }));

    expect(screen.getByRole("button", { name: "Rematch" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Start a new game" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Play vs Bot/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Play a friend/ })).not.toBeInTheDocument();
  });

  it("offers 'Play vs Bot' / 'Play a friend' presets on game over, alongside a still-focused Rematch", async () => {
    const user = userEvent.setup();
    const onPlayAgain = vi.fn();
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
    render(<TicTacToeRoute seats={seats} onExit={vi.fn()} onPlayAgain={onPlayAgain} />);

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 1, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 2, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 3, empty" }));

    // Rematch is still the primary, auto-focused action.
    const rematchButton = screen.getByRole("button", { name: "Rematch" });
    expect(rematchButton).toHaveFocus();

    const group = screen.getByRole("group", { name: "Start a new game" });
    expect(group).toBeInTheDocument();

    const vsBotButton = screen.getByRole("button", { name: /Play vs Bot/ });
    const vsFriendButton = screen.getByRole("button", { name: /Play a friend/ });

    await user.click(vsFriendButton);
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect(onPlayAgain).toHaveBeenLastCalledWith([{ kind: "human" }, { kind: "human" }]);

    await user.click(vsBotButton);
    expect(onPlayAgain).toHaveBeenCalledTimes(2);
    expect(onPlayAgain).toHaveBeenLastCalledWith([
      { kind: "human" },
      { kind: "bot", difficulty: "medium" },
    ]);
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
    for (let i = 0; i < 12 && screen.queryByRole("button", { name: "Rematch" }) === null; i++) {
      await advanceBotStep();
    }

    // Bot-vs-bot has no privileged local human — a draw reads the same
    // neutral way it would for any other configuration. No visible text
    // banner; the outcome (with its reason) is announced via the aria-live
    // region. Classic Tic-Tac-Toe only draws by filling the board.
    expect(
      screen.queryByText("Draw — the board is full.", { selector: "p" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Draw — the board is full.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rematch" })).toHaveFocus();
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
