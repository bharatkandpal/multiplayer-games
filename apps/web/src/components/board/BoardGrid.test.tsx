import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BoardGrid } from "./BoardGrid";
import type { BoardCellSpec } from "./BoardGrid";
import styles from "./BoardGrid.module.css";

/**
 * The shared board primitive (UI-10 / MPG-117). The five board suites already
 * cover each game's own rules through it; what is tested here is the contract
 * they all now depend on, so a change to the grid pattern breaks one suite
 * rather than five.
 */

const label = (row: number, col: number) => `Row ${row + 1}, column ${col + 1}`;

function renderGrid(overrides: Partial<React.ComponentProps<typeof BoardGrid>> = {}) {
  const onActivate = vi.fn();
  const result = render(
    <BoardGrid
      rows={3}
      cols={3}
      label="Test board"
      disabled={false}
      maxWidth="22rem"
      cell={(row, col): BoardCellSpec => ({ label: label(row, col), activatable: true })}
      onActivate={onActivate}
      {...overrides}
    />,
  );
  return { ...result, onActivate };
}

describe("BoardGrid", () => {
  it("renders the WAI-ARIA grid pattern — a grid of rows of gridcells", () => {
    renderGrid();
    expect(screen.getByRole("grid", { name: "Test board" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getAllByRole("gridcell")).toHaveLength(9);
  });

  it("exposes exactly one cell to the tab sequence (roving tabindex)", () => {
    renderGrid();
    const tabbable = screen
      .getAllByRole("gridcell")
      .filter((cell) => cell.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName(label(0, 0));
  });

  it("moves focus with the arrow keys and wraps at the edges", async () => {
    const user = userEvent.setup();
    renderGrid();

    screen.getByRole("gridcell", { name: label(0, 0) }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("gridcell", { name: label(0, 1) })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("gridcell", { name: label(1, 1) })).toHaveFocus();

    // Wrapping: left off the first column lands on the last, up off the first
    // row lands on the last.
    screen.getByRole("gridcell", { name: label(0, 0) }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("gridcell", { name: label(0, 2) })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("gridcell", { name: label(2, 2) })).toHaveFocus();
  });

  it("jumps to the ends of the row with Home and End", async () => {
    const user = userEvent.setup();
    renderGrid();

    screen.getByRole("gridcell", { name: label(1, 1) }).focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("gridcell", { name: label(1, 2) })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("gridcell", { name: label(1, 0) })).toHaveFocus();
  });

  it("activates an activatable cell and reports its coordinates", async () => {
    const user = userEvent.setup();
    const { onActivate } = renderGrid();

    await user.click(screen.getByRole("gridcell", { name: label(2, 1) }));
    expect(onActivate).toHaveBeenCalledWith(2, 1);
  });

  it("swallows activation of a non-activatable cell but keeps it readable and focusable", async () => {
    const user = userEvent.setup();
    const { onActivate } = renderGrid({
      cell: (row, col) => ({ label: label(row, col), activatable: row === 0 }),
    });

    const blocked = screen.getByRole("gridcell", { name: label(1, 0) });
    await user.click(blocked);
    expect(onActivate).not.toHaveBeenCalled();
    expect(blocked).toHaveAttribute("aria-disabled", "true");

    // Still focusable: a board you cannot move on is still a board you can read.
    blocked.focus();
    expect(blocked).toHaveFocus();
  });

  it("lets a game take over a key with preventDefault, and otherwise runs the built-in nav", async () => {
    const user = userEvent.setup();
    const onCellKeyDown = vi.fn((event: React.KeyboardEvent) => {
      if (event.key === "ArrowRight") event.preventDefault();
    });
    renderGrid({ onCellKeyDown });

    screen.getByRole("gridcell", { name: label(0, 0) }).focus();
    await user.keyboard("{ArrowRight}");
    // The game claimed ArrowRight, so focus did not move.
    expect(screen.getByRole("gridcell", { name: label(0, 0) })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(onCellKeyDown).toHaveBeenCalled();
    expect(screen.getByRole("gridcell", { name: label(1, 0) })).toHaveFocus();
  });

  it("applies the shared state rings, with the loss tone swapping only the hue", () => {
    const { rerender } = renderGrid({
      cell: (row, col) => ({
        label: label(row, col),
        activatable: false,
        lastMove: row === 0 && col === 0,
        winning: row === 1,
      }),
    });

    expect(screen.getByRole("gridcell", { name: label(0, 0) }).className).toContain(
      styles.lastMove,
    );
    expect(screen.getByRole("gridcell", { name: label(1, 0) }).className).toContain(styles.winning);

    rerender(
      <BoardGrid
        rows={3}
        cols={3}
        label="Test board"
        disabled={false}
        maxWidth="22rem"
        winningTone="loss"
        cell={(row, col) => ({ label: label(row, col), activatable: false, winning: row === 1 })}
        onActivate={vi.fn()}
      />,
    );
    const lost = screen.getByRole("gridcell", { name: label(1, 0) });
    expect(lost.className).toContain(styles.winningLoss);
    expect(lost.className).not.toContain(styles.winning);
  });

  it("passes game-specific modifier classes through without losing the shared ones", () => {
    renderGrid({
      cell: (row, col) => ({
        label: label(row, col),
        activatable: true,
        lastMove: true,
        className: "game-specific",
      }),
    });
    const cell = screen.getByRole("gridcell", { name: label(0, 0) });
    expect(cell.className).toContain("game-specific");
    expect(cell.className).toContain(styles.lastMove);
  });

  it("drives the layout clamp and density from props, not from each board's stylesheet", () => {
    const { rerender } = renderGrid();
    const grid = screen.getByRole("grid");

    // The MPG-137 clamp: the board's own aspect (cols/rows) applied to the
    // height budget. A square board divides the budget by 1.
    expect(grid.style.getPropertyValue("--board-max-inline")).toBe("22rem");
    expect(grid.style.getPropertyValue("--board-height-budget")).toBe("100cqh");
    expect(grid.style.getPropertyValue("--board-aspect")).toBe("1");
    expect(grid.className).not.toContain(styles.dense);

    rerender(
      <BoardGrid
        rows={9}
        cols={9}
        label="Test board"
        disabled={false}
        density="dense"
        maxWidth="32rem"
        heightBudget="calc(100cqh - 3rem)"
        cell={(row, col) => ({ label: label(row, col), activatable: true })}
        onActivate={vi.fn()}
      />,
    );
    const dense = screen.getByRole("grid");
    expect(dense.className).toContain(styles.dense);
    expect(dense.style.getPropertyValue("--board-height-budget")).toBe("calc(100cqh - 3rem)");
    expect(screen.getAllByRole("gridcell")).toHaveLength(81);
  });

  it("marks the whole grid aria-disabled when it isn't the local human's turn", () => {
    renderGrid({ disabled: true });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-disabled", "true");
  });
});
