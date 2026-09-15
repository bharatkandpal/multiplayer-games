import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GomokuState } from "@mpg/engine";
import { GomokuBoard } from "./GomokuBoard";
// The state rings live on the shared primitive now (UI-10), not on the game's own sheet.
import styles from "./BoardGrid.module.css";

const SIZE = 9;

/** A board cell, mirroring the engine's un-exported `Cell` (empty, or the owning player). */
type BoardCell = 1 | 2 | null;

function emptyState(): GomokuState {
  return { board: Array.from({ length: SIZE }, () => new Array<BoardCell>(SIZE).fill(null)) };
}

/** An empty board with the given stones placed, e.g. `withStones([[4, 4, 1]])`. */
function withStones(stones: readonly (readonly [number, number, 1 | 2])[]): GomokuState {
  const board = emptyState().board.map((row) => [...row]);
  for (const [row, col, mark] of stones) {
    const boardRow = board[row];
    if (boardRow) boardRow[col] = mark;
  }
  return { board };
}

describe("GomokuBoard", () => {
  it("renders all 81 cells, labelled empty on a fresh board", () => {
    render(<GomokuBoard state={emptyState()} onMove={vi.fn()} disabled={false} lastMove={null} />);
    expect(screen.getAllByRole("gridcell")).toHaveLength(SIZE * SIZE);
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 9, column 9, empty" })).toBeInTheDocument();
  });

  it("labels the two sides distinguishably", () => {
    render(
      <GomokuBoard
        state={withStones([
          [0, 0, 1],
          [0, 1, 2],
        ])}
        onMove={vi.fn()}
        disabled={false}
        lastMove={null}
      />,
    );
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, black" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 1, column 2, white" })).toBeInTheDocument();
  });

  it("calls onMove with {row, col} when an empty cell is clicked", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<GomokuBoard state={emptyState()} onMove={onMove} disabled={false} lastMove={null} />);

    await user.click(screen.getByRole("gridcell", { name: "Row 5, column 3, empty" }));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ row: 4, col: 2 });
  });

  it("ignores clicks on an occupied cell and marks it aria-disabled", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <GomokuBoard
        state={withStones([[4, 4, 1]])}
        onMove={onMove}
        disabled={false}
        lastMove={null}
      />,
    );

    const occupied = screen.getByRole("gridcell", { name: "Row 5, column 5, black" });
    expect(occupied).toHaveAttribute("aria-disabled", "true");
    await user.click(occupied);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("ignores clicks entirely while disabled, and marks the grid aria-disabled", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<GomokuBoard state={emptyState()} onMove={onMove} disabled={true} lastMove={null} />);

    expect(screen.getByRole("grid")).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("highlights the winning line, and uses the loss tone when asked", () => {
    const line = [
      { row: 4, col: 0 },
      { row: 4, col: 1 },
      { row: 4, col: 2 },
      { row: 4, col: 3 },
      { row: 4, col: 4 },
    ];
    const state = withStones(line.map(({ row, col }) => [row, col, 1] as const));

    const { rerender } = render(
      <GomokuBoard
        state={state}
        onMove={vi.fn()}
        disabled={true}
        lastMove={null}
        winningLine={line}
      />,
    );
    const winningCell = screen.getByRole("gridcell", { name: "Row 5, column 1, black" });
    expect(winningCell.className).toContain(styles.winning);

    rerender(
      <GomokuBoard
        state={state}
        onMove={vi.fn()}
        disabled={true}
        lastMove={null}
        winningLine={line}
        winningLineTone="loss"
      />,
    );
    expect(screen.getByRole("gridcell", { name: "Row 5, column 1, black" }).className).toContain(
      styles.winningLoss,
    );
  });

  it("marks the last move so the opponent's reply is findable on a 9x9 board", () => {
    render(
      <GomokuBoard
        state={withStones([[2, 6, 2]])}
        onMove={vi.fn()}
        disabled={false}
        lastMove={{ move: { row: 2, col: 6 }, player: 2 }}
      />,
    );
    expect(screen.getByRole("gridcell", { name: "Row 3, column 7, white" }).className).toContain(
      styles.lastMove,
    );
  });

  describe("keyboard navigation (WAI-ARIA grid pattern)", () => {
    it("moves focus in two dimensions with the arrow keys", async () => {
      const user = userEvent.setup();
      render(
        <GomokuBoard state={emptyState()} onMove={vi.fn()} disabled={false} lastMove={null} />,
      );

      await user.tab();
      expect(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" })).toHaveFocus();

      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("gridcell", { name: "Row 1, column 2, empty" })).toHaveFocus();

      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" })).toHaveFocus();

      await user.keyboard("{ArrowLeft}");
      expect(screen.getByRole("gridcell", { name: "Row 2, column 1, empty" })).toHaveFocus();

      await user.keyboard("{ArrowUp}");
      expect(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" })).toHaveFocus();
    });

    it("wraps around the board edges rather than dead-ending", async () => {
      const user = userEvent.setup();
      render(
        <GomokuBoard state={emptyState()} onMove={vi.fn()} disabled={false} lastMove={null} />,
      );

      await user.tab();
      await user.keyboard("{ArrowLeft}");
      expect(screen.getByRole("gridcell", { name: "Row 1, column 9, empty" })).toHaveFocus();

      await user.keyboard("{ArrowUp}");
      expect(screen.getByRole("gridcell", { name: "Row 9, column 9, empty" })).toHaveFocus();
    });

    it("jumps to the row ends with Home/End", async () => {
      const user = userEvent.setup();
      render(
        <GomokuBoard state={emptyState()} onMove={vi.fn()} disabled={false} lastMove={null} />,
      );

      await user.tab();
      await user.keyboard("{End}");
      expect(screen.getByRole("gridcell", { name: "Row 1, column 9, empty" })).toHaveFocus();

      await user.keyboard("{Home}");
      expect(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" })).toHaveFocus();
    });

    it("keeps exactly one cell in the tab order (roving tabindex)", () => {
      render(
        <GomokuBoard state={emptyState()} onMove={vi.fn()} disabled={false} lastMove={null} />,
      );
      const tabbable = screen
        .getAllByRole("gridcell")
        .filter((cell) => cell.getAttribute("tabindex") === "0");
      expect(tabbable).toHaveLength(1);
    });

    it("places a stone with the keyboard", async () => {
      const user = userEvent.setup();
      const onMove = vi.fn();
      render(<GomokuBoard state={emptyState()} onMove={onMove} disabled={false} lastMove={null} />);

      await user.tab();
      await user.keyboard("{ArrowDown}{ArrowRight}{Enter}");
      expect(onMove).toHaveBeenCalledExactlyOnceWith({ row: 1, col: 1 });
    });
  });
});
