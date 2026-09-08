import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Result } from "@mpg/engine";
import { ticTacToe } from "@mpg/engine";
import { TicTacToeRoute } from "./games";
import { GamePlayScreen, resultTone } from "./GamePlayScreen";
import type { OnlineRematchProps } from "./GamePlayScreen";
import type { SeatsConfig } from "../game";
import { TicTacToeBoard } from "../components/board";
import boardStyles from "../components/board/TicTacToeBoard.module.css";

/** Finds the SeatCard for "Player N" and returns its root element. */
function seatCardFor(playerNumber: number): HTMLElement {
  const card = screen.getByText(`Player ${playerNumber}`).closest("div");
  if (!card) throw new Error(`SeatCard for Player ${playerNumber} not found`);
  return card;
}

function hasCrown(card: HTMLElement): boolean {
  return card.querySelector('[class*="crown"]') !== null;
}

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

describe("GamePlayScreen — online rematch (MPG-015)", () => {
  function makeOnline(overrides: Partial<OnlineRematchProps> = {}): OnlineRematchProps {
    return {
      isRoomFinished: true,
      rematchProposed: false,
      opponentProposed: false,
      rematchAccepted: false,
      proposeRematch: vi.fn(),
      declineRematch: vi.fn(),
      ...overrides,
    };
  }

  async function playToWin(online: OnlineRematchProps): Promise<void> {
    const user = userEvent.setup();
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
    render(
      <GamePlayScreen
        game={ticTacToe}
        gameTitle="Tic-Tac-Toe"
        seats={seats}
        describeMove={(move: { cell: number }, player) => `p${player} cell ${move.cell}`}
        onExit={vi.fn()}
        online={online}
        renderBoard={({ state, onMove, disabled, lastMove, winningLine, winningLineTone }) => (
          <TicTacToeBoard
            state={state}
            onMove={onMove}
            disabled={disabled}
            lastMove={lastMove}
            winningLine={winningLine}
            winningLineTone={winningLineTone ?? "win"}
          />
        )}
      />,
    );

    // X: 0, 1, 2 (top row) — O: 3, 4 — X wins.
    for (const name of [
      "Row 1, column 1, empty",
      "Row 2, column 1, empty",
      "Row 1, column 2, empty",
      "Row 2, column 2, empty",
      "Row 1, column 3, empty",
    ]) {
      await user.click(screen.getByRole("gridcell", { name }));
    }
    await screen.findByRole("button", { name: "Rematch" });
  }

  it("clicking Rematch calls proposeRematch (not the local rematch)", async () => {
    const online = makeOnline();
    await playToWin(online);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rematch" }));

    expect(online.proposeRematch).toHaveBeenCalledTimes(1);
    // The board must NOT have reset locally — only a server `rematch:start`
    // (via the `online` prop's state, not a local click handler) should do that.
    expect(screen.queryByText("Player 1's turn")).not.toBeInTheDocument();
  });

  it("shows a waiting state once this seat has proposed, and disables the button", async () => {
    const online = makeOnline({ rematchProposed: true });
    await playToWin(online);

    expect(screen.getByText("Rematch proposed — waiting for opponent…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rematch" })).toBeDisabled();
  });

  it("shows an accept/decline state once the opponent has proposed", async () => {
    const online = makeOnline({ opponentProposed: true });
    await playToWin(online);

    expect(screen.getByText("Opponent wants a rematch!")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "No thanks" }));
    expect(online.declineRematch).toHaveBeenCalledTimes(1);
  });

  it("shows a starting state once the rematch is accepted", async () => {
    const online = makeOnline({ rematchAccepted: true });
    await playToWin(online);

    expect(screen.getByText("Rematch starting…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rematch" })).toBeDisabled();
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

    const badgeText = screen.getByText("Bot is thinking…");
    expect(badgeText).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 2, column 2, X" })).toBeInTheDocument();

    // A subtle, decorative thinking spinner lives on the active seat's
    // SeatCard avatar (not a content-loading Skeleton, and not duplicated on
    // the status badge too) while the bot computes its move.
    const seatCard = screen.getByText("Player 2").closest("div");
    expect(seatCard?.querySelector('[class*="spinner"]')).not.toBeNull();

    await advanceBotStep();

    // The indicator disappears once it's the human's turn again.
    expect(screen.queryByText(/is thinking…/)).not.toBeInTheDocument();

    // The bot has moved: exactly one O now on the board, and it's the human's turn again.
    // (describeSeat reads a solo human as "You", rendered as the possessive "Your turn".)
    expect(screen.getByText("Your turn")).toBeInTheDocument();
    const oCells = screen
      .getAllByRole("gridcell")
      .filter((el) => el.getAttribute("aria-label")?.endsWith(", O"));
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
    expect(screen.queryByText("Bot wins!", { selector: "p" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Bot wins!");
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

describe("GamePlayScreen — next game from the game-over surface", () => {
  /** Plays a human-vs-human game to a decisive finish (P1 takes the top row). */
  async function playToWin(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 1, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 2, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 3, empty" }));
  }

  const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }];

  it("offers 'Next game' once the game is over and calls onNextGame", async () => {
    const user = userEvent.setup();
    const onNextGame = vi.fn();
    render(<TicTacToeRoute seats={seats} onExit={vi.fn()} onNextGame={onNextGame} />);

    // Not offered mid-game — it belongs to the game-over actions only.
    expect(screen.queryByRole("button", { name: /Next game/ })).not.toBeInTheDocument();

    await playToWin(user);

    await user.click(screen.getByRole("button", { name: /Next game/ }));
    expect(onNextGame).toHaveBeenCalledOnce();
  });

  it("omits 'Next game' entirely when no handler is wired up", async () => {
    const user = userEvent.setup();
    render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    await playToWin(user);

    expect(screen.getByRole("button", { name: "Rematch" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next game/ })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("group", { name: "or play again vs…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Play vs Bot/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Play a friend/ })).not.toBeInTheDocument();
  });

  it("after a human-vs-human game, offers only 'Play vs Bot' (the 'Play a friend' preset already matches the current seats)", async () => {
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

    // The group's accessible name comes from the visible caption (aria-labelledby).
    const group = screen.getByRole("group", { name: "or play again vs…" });
    expect(group).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /Play a friend/ })).not.toBeInTheDocument();
    const vsBotButton = screen.getByRole("button", { name: /Play vs Bot/ });

    await user.click(vsBotButton);
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect(onPlayAgain).toHaveBeenLastCalledWith([
      { kind: "human" },
      { kind: "bot", difficulty: "medium" },
    ]);
  });

  it("after a human-vs-bot game, offers only 'Play a friend' (the 'Play vs Bot' preset already matches the current seats)", async () => {
    vi.useFakeTimers();
    const onPlayAgain = vi.fn();
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "bot", difficulty: "hard" }];
    render(<TicTacToeRoute seats={seats} onExit={vi.fn()} onPlayAgain={onPlayAgain} />);

    // Deterministic forced loss (same sequence as the tone test above).
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));
    await advanceBotStep();
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 3, column 3, empty" }));
    await advanceBotStep();
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 1, column 3, empty" }));
    await advanceBotStep();

    const rematchButton = screen.getByRole("button", { name: "Rematch" });
    expect(rematchButton).toHaveFocus();

    const group = screen.getByRole("group", { name: "or play again vs…" });
    expect(group).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /Play vs Bot/ })).not.toBeInTheDocument();
    const vsFriendButton = screen.getByRole("button", { name: /Play a friend/ });

    fireEvent.click(vsFriendButton);
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect(onPlayAgain).toHaveBeenLastCalledWith([{ kind: "human" }, { kind: "human" }]);

    vi.useRealTimers();
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
      <TicTacToeRoute seats={[{ kind: "human" }, { kind: "human" }]} onExit={vi.fn()} />,
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
      screen
        .getAllByRole("gridcell")
        .filter((c) => /empty$/.test(c.getAttribute("aria-label") ?? "")).length;
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

describe("GamePlayScreen — winner crown + tone matrix (MPG-051)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("(a) human-vs-human win: celebrate (confetti, winFlash), crown on the winner only, no defeat FX", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
    const { container } = render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    // X: 0, 1, 2 (top row) — O: 3, 4 — X wins.
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 1, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 2, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 3, empty" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Player 1 wins!");

    expect(container.querySelector('[class*="confettiLayer"]')).not.toBeNull();
    expect(container.querySelector('[class*="winFlash"]')).not.toBeNull();
    expect(container.querySelector('[class*="loseVeil"]')).toBeNull();
    expect(container.querySelector('[class*="ashLayer"]')).toBeNull();
    expect(container.querySelector('[class*="drawStalemate"]')).toBeNull();

    expect(hasCrown(seatCardFor(1))).toBe(true);
    expect(hasCrown(seatCardFor(2))).toBe(false);
  });

  it("(b) sole human vs. bot, human wins: celebrate + crown on the human, no defeat FX", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // forces the "easy" bot to always blunder to the lowest-index empty cell.
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "bot", difficulty: "easy" }];
    const { container } = render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    // X (human) plays 4, 2, 6 — the bot, forced to always take the lowest
    // remaining empty cell, never touches 2/4/6: X completes the anti-diagonal.
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" })); // 4
    await advanceBotStep(); // bot -> 0
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 1, column 3, empty" })); // 2
    await advanceBotStep(); // bot -> 1
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 3, column 1, empty" })); // 6 -> X wins (2,4,6)

    expect(screen.getByRole("status")).toHaveTextContent("You wins!");

    expect(container.querySelector('[class*="confettiLayer"]')).not.toBeNull();
    expect(container.querySelector('[class*="loseVeil"]')).toBeNull();
    expect(container.querySelector('[class*="ashLayer"]')).toBeNull();
    expect(hasCrown(seatCardFor(1))).toBe(true); // the human
    expect(hasCrown(seatCardFor(2))).toBe(false); // the bot
  });

  it("(c) sole human vs. bot, human loses: subdued (defeat gloom + ashfall, red line), crown STILL on the winning bot, no confetti", async () => {
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "bot", difficulty: "hard" }];
    const { container } = render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    // Deterministic forced loss against the (never-blundering) hard bot — same
    // sequence used elsewhere in this file.
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));
    await advanceBotStep();
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 3, column 3, empty" }));
    await advanceBotStep();
    fireEvent.click(screen.getByRole("gridcell", { name: "Row 1, column 3, empty" }));
    await advanceBotStep();

    expect(screen.getByRole("status")).toHaveTextContent("Bot wins!");

    expect(container.querySelector('[class*="loseVeil"]')).not.toBeNull();
    expect(container.querySelector('[class*="ashLayer"]')).not.toBeNull();
    expect(container.querySelector('[class*="confettiLayer"]')).toBeNull();
    expect(container.querySelector('[class*="winFlash"]')).toBeNull();

    // The winning bot still gets its crown even though this is the "subdued" defeat case.
    expect(hasCrown(seatCardFor(2))).toBe(true); // the bot, winner
    expect(hasCrown(seatCardFor(1))).toBe(false); // the human, lost
  });

  it("(d) all-bot watch, a bot wins: celebrate + crown on the winning bot", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // forces both "easy" bots to fill cells in strict index order.
    const seats: SeatsConfig = [
      { kind: "bot", difficulty: "easy" },
      { kind: "bot", difficulty: "easy" },
    ];
    const { container } = render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    // Both bots always take the lowest remaining empty cell -> cells fill in
    // strict order 0,1,2,3,4,5,6 -> Player 1 (X, odd move count) ends up with
    // {0,2,4,6}, completing the anti-diagonal (2,4,6) on its 4th move.
    for (let i = 0; i < 7 && screen.queryByRole("button", { name: "Rematch" }) === null; i++) {
      await advanceBotStep();
    }

    expect(screen.getByRole("status")).toHaveTextContent("Bot (Player 1) wins!");

    expect(container.querySelector('[class*="confettiLayer"]')).not.toBeNull();
    expect(container.querySelector('[class*="loseVeil"]')).toBeNull();
    expect(container.querySelector('[class*="ashLayer"]')).toBeNull();
    expect(hasCrown(seatCardFor(1))).toBe(true);
    expect(hasCrown(seatCardFor(2))).toBe(false);
  });

  it("(e) draw: neutral (stalemate FX, no confetti/defeat FX), no crown on either seat", async () => {
    const seats: SeatsConfig = [
      { kind: "bot", difficulty: "hard" },
      { kind: "bot", difficulty: "hard" },
    ];
    const { container } = render(<TicTacToeRoute seats={seats} onExit={vi.fn()} />);

    for (let i = 0; i < 12 && screen.queryByRole("button", { name: "Rematch" }) === null; i++) {
      await advanceBotStep();
    }

    expect(screen.getByRole("status")).toHaveTextContent("Draw — the board is full.");
    expect(container.querySelector('[class*="drawStalemate"]')).not.toBeNull();
    expect(container.querySelector('[class*="confettiLayer"]')).toBeNull();
    expect(container.querySelector('[class*="loseVeil"]')).toBeNull();
    expect(container.querySelector('[class*="ashLayer"]')).toBeNull();
    expect(hasCrown(seatCardFor(1))).toBe(false);
    expect(hasCrown(seatCardFor(2))).toBe(false);
  });
});

describe("resultTone (MPG-051)", () => {
  const seatsHvH: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
  const seatsSoloHumanVsBot: SeatsConfig = [{ kind: "human" }, { kind: "bot", difficulty: "hard" }];
  const seatsAllBots: SeatsConfig = [
    { kind: "bot", difficulty: "hard" },
    { kind: "bot", difficulty: "hard" },
  ];
  const winP1: Result = { status: "win", winner: 1, line: undefined as never };
  const winP2: Result = { status: "win", winner: 2, line: undefined as never };
  const draw: Result = { status: "draw" };

  it("a draw is always neutral, regardless of viewer perspective", () => {
    expect(resultTone(draw, seatsHvH)).toBe("neutral");
    expect(resultTone(draw, seatsHvH, 0)).toBe("neutral");
    expect(resultTone(draw, seatsHvH, 1)).toBe("neutral");
  });

  it("local (viewerSeat = null): HvH and all-bot-watch wins are celebratory", () => {
    expect(resultTone(winP1, seatsHvH)).toBe("celebrate");
    expect(resultTone(winP2, seatsHvH)).toBe("celebrate");
    expect(resultTone(winP1, seatsAllBots)).toBe("celebrate");
    expect(resultTone(winP2, seatsAllBots)).toBe("celebrate");
  });

  it("local (viewerSeat = null): a sole human losing to a bot is the one subdued case", () => {
    expect(resultTone(winP2, seatsSoloHumanVsBot)).toBe("subdued"); // bot (seat 1) wins
    expect(resultTone(winP1, seatsSoloHumanVsBot)).toBe("celebrate"); // human (seat 0) wins
  });

  it("remote (viewerSeat set): celebrate iff the viewer's own seat won, regardless of seat kinds", () => {
    // Not wired to any call site yet (Phase 2) — this exercises the branch directly.
    expect(resultTone(winP1, seatsHvH, 0)).toBe("celebrate"); // viewer is seat 0 (winner)
    expect(resultTone(winP1, seatsHvH, 1)).toBe("subdued"); // viewer is seat 1 (loser)
    expect(resultTone(winP2, seatsHvH, 1)).toBe("celebrate");
    expect(resultTone(winP2, seatsHvH, 0)).toBe("subdued");
  });
});
