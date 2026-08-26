import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TicTacToeState } from "@mpg/engine";
import { TicTacToeBoard } from "./TicTacToeBoard";
import styles from "./TicTacToeBoard.module.css";

function emptyState(): TicTacToeState {
  return { board: new Array(9).fill(null) };
}

describe("TicTacToeBoard", () => {
  it("renders 9 grid cells, all labelled empty on a fresh board", () => {
    render(<TicTacToeBoard state={emptyState()} onMove={vi.fn()} disabled={false} lastMove={null} />);
    expect(screen.getAllByRole("gridcell")).toHaveLength(9);
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" })).toBeInTheDocument();
  });

  it("renders X and O marks with distinct, non-empty labels", () => {
    const state: TicTacToeState = { board: emptyState().board.slice() };
    const board = state.board.slice();
    board[0] = 1;
    board[1] = 2;
    render(
      <TicTacToeBoard state={{ board }} onMove={vi.fn()} disabled={false} lastMove={null} />,
    );

    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, X" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 1, column 2, O" })).toBeInTheDocument();
  });

  it("calls onMove with the cell index when an empty cell is clicked", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<TicTacToeBoard state={emptyState()} onMove={onMove} disabled={false} lastMove={null} />);

    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" }));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ cell: 4 });
  });

  it("does not call onMove for an already-occupied cell, and marks it aria-disabled", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const board = emptyState().board.slice();
    board[0] = 1;
    render(<TicTacToeBoard state={{ board }} onMove={onMove} disabled={false} lastMove={null} />);

    const cell = screen.getByRole("gridcell", { name: "Row 1, column 1, X" });
    expect(cell).toHaveAttribute("aria-disabled", "true");
    expect(cell).not.toBeDisabled();
    await user.click(cell);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("marks every cell aria-disabled and ignores clicks when disabled, without removing them from the tab order", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<TicTacToeBoard state={emptyState()} onMove={onMove} disabled lastMove={null} />);

    const cells = screen.getAllByRole("gridcell");
    for (const cell of cells) {
      expect(cell).toHaveAttribute("aria-disabled", "true");
      expect(cell).not.toBeDisabled();
    }

    // The roving-tabindex cell must stay keyboard-reachable even while disabled
    // (native `disabled` would yank the whole board out of the tab order).
    expect(cells[0]).toHaveAttribute("tabindex", "0");
    (cells[0] as HTMLElement).focus();
    expect(cells[0]).toHaveFocus();

    await user.click(cells[4] as HTMLElement);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps arrow-key navigation working across a disabled board", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<TicTacToeBoard state={emptyState()} onMove={onMove} disabled lastMove={null} />);

    const first = screen.getByRole("gridcell", { name: "Row 1, column 1, empty" });
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("gridcell", { name: "Row 1, column 2, empty" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("marks the last-moved cell distinctly from other filled cells", () => {
    const board = emptyState().board.slice();
    board[4] = 1;
    render(
      <TicTacToeBoard
        state={{ board }}
        onMove={vi.fn()}
        disabled={false}
        lastMove={{ move: { cell: 4 }, player: 1 }}
      />,
    );

    const lastMoveCell = screen.getByRole("gridcell", { name: "Row 2, column 2, X" });
    const otherEmptyCell = screen.getByRole("gridcell", { name: "Row 1, column 1, empty" });
    expect(lastMoveCell.className).not.toBe(otherEmptyCell.className);
  });

  it("highlights the three winning cells when a winningLine is supplied", () => {
    const board = emptyState().board.slice();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1; // X wins the top row
    render(
      <TicTacToeBoard
        state={{ board }}
        onMove={vi.fn()}
        disabled
        lastMove={{ move: { cell: 2 }, player: 1 }}
        winningLine={[0, 1, 2]}
      />,
    );

    for (const name of ["Row 1, column 1, X", "Row 1, column 2, X", "Row 1, column 3, X"]) {
      expect(screen.getByRole("gridcell", { name }).className).toMatch(/winning/);
    }
    // A non-winning empty cell must not be highlighted.
    expect(screen.getByRole("gridcell", { name: "Row 3, column 1, empty" }).className).not.toMatch(
      /winning/,
    );
  });

  it("recolors the winning line red when winningLineTone is 'loss', not the default green", () => {
    const board = emptyState().board.slice();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1; // X wins the top row

    render(
      <TicTacToeBoard
        state={{ board }}
        onMove={vi.fn()}
        disabled
        lastMove={{ move: { cell: 2 }, player: 1 }}
        winningLine={[0, 1, 2]}
        winningLineTone="loss"
      />,
    );

    for (const name of ["Row 1, column 1, X", "Row 1, column 2, X", "Row 1, column 3, X"]) {
      const cell = screen.getByRole("gridcell", { name });
      expect(cell.className).toMatch(/winningLoss/);
      expect(cell.classList.contains(styles.winning!)).toBe(false);
    }
  });

  it("supports arrow-key roving-tabindex navigation between cells", async () => {
    const user = userEvent.setup();
    render(<TicTacToeBoard state={emptyState()} onMove={vi.fn()} disabled={false} lastMove={null} />);

    const first = screen.getByRole("gridcell", { name: "Row 1, column 1, empty" });
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("gridcell", { name: "Row 1, column 2, empty" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" })).toHaveFocus();
  });
});
