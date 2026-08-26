import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TicTacToeMoveRoute } from "./games";
import type { SeatsConfig } from "../game";
import boardStyles from "../components/board/TicTacToeMoveBoard.module.css";

/**
 * Integration play-through for the "tictactoe-move" route (MPG-045-d) —
 * mirrors the classic TicTacToeRoute tests in GamePlayScreen.test.tsx, but
 * drives the game through BOTH phases: placement (3 pieces each), then at
 * least one relocation, ending in a 3-in-a-row win via a moved piece.
 */
describe("GamePlayScreen — local play-through (via TicTacToeMoveRoute)", () => {
  it("plays a full human-vs-human game: all placements, then a relocation to win", async () => {
    const user = userEvent.setup();
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
    render(<TicTacToeMoveRoute seats={seats} onExit={vi.fn()} />);

    expect(screen.getByText("Player 1's turn")).toBeInTheDocument();

    // Placement phase — 3 pieces each, alternating turns.
    // X: 0, 1, 6 — O: 3, 4, 8.
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" })); // X -> 0
    expect(screen.getByText("Player 2's turn")).toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 1, empty" })); // O -> 3
    expect(screen.getByText("Player 1's turn")).toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 2, empty" })); // X -> 1
    expect(screen.getByText("Player 2's turn")).toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" })); // O -> 4
    expect(screen.getByText("Player 1's turn")).toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: "Row 3, column 1, empty" })); // X -> 6
    expect(screen.getByText("Player 2's turn")).toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: "Row 3, column 3, empty" })); // O -> 8
    expect(screen.getByText("Player 1's turn")).toBeInTheDocument();

    // Move phase — all 6 pieces are down, game is still in progress.
    expect(screen.getByText("Player 1's turn")).toBeInTheDocument();

    // X relocates its piece at 6 (row 3, col 1) to 2 (row 1, col 3), completing
    // the top row {0, 1, 2} for a win — select then choose the target.
    await user.click(screen.getByRole("gridcell", { name: "Row 3, column 1, X" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 3, empty" }));

    // No dialog — the result is shown inline, board fully visible underneath.
    // Two `role="status"` live regions exist (the board's own phase prompt,
    // plus the screen's move/result announcer) — find the one announcing the win.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      const statuses = screen.getAllByRole("status");
      expect(statuses.some((el) => el.textContent?.includes("Player 1 wins!"))).toBe(true);
    });

    // The relocated piece landed on its new cell, and the old cell is now empty.
    expect(screen.getByRole("gridcell", { name: "Row 1, column 3, X" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 3, column 1, empty" })).toBeInTheDocument();

    // Neutral/win tone highlights the winning row.
    for (const name of ["Row 1, column 1, X", "Row 1, column 2, X", "Row 1, column 3, X"]) {
      const cell = screen.getByRole("gridcell", { name });
      expect(cell.classList.contains(boardStyles.winning!)).toBe(true);
      expect(cell.classList.contains(boardStyles.winningLoss!)).toBe(false);
    }

    // Board is still visible (and inert) once the game is over.
    const inertCell = screen.getByRole("gridcell", { name: "Row 3, column 3, O" });
    expect(inertCell.getAttribute("aria-disabled")).toBe("true");

    // Rematch is the primary next action, focused automatically.
    const rematchButton = screen.getByRole("button", { name: "Rematch" });
    expect(rematchButton).toHaveFocus();
  });

  it("Home (top bar) exits immediately", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
    render(<TicTacToeMoveRoute seats={seats} onExit={onExit} />);

    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
