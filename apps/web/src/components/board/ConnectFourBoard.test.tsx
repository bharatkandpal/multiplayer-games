import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConnectFourState } from "@mpg/engine";
import { ConnectFourBoard } from "./ConnectFourBoard";
import styles from "./ConnectFourBoard.module.css";

const COLUMNS = 7;
const ROWS = 6;

function emptyState(): ConnectFourState {
  return {
    board: Array.from({ length: COLUMNS }, () => new Array(ROWS).fill(null)),
  };
}

describe("ConnectFourBoard", () => {
  it("renders 7 column buttons, all enabled and labelled 'Drop a disc' on an empty board", () => {
    render(<ConnectFourBoard state={emptyState()} onMove={vi.fn()} disabled={false} lastMove={null} />);
    const columns = screen.getAllByRole("button");
    expect(columns).toHaveLength(COLUMNS);
    const firstColumn = screen.getByRole("button", { name: "Drop a disc in column 1" });
    expect(firstColumn).toBeEnabled();
    expect(firstColumn).toHaveAttribute("aria-disabled", "false");
  });

  it("calls onMove with the clicked column", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ConnectFourBoard state={emptyState()} onMove={onMove} disabled={false} lastMove={null} />);

    await user.click(screen.getByRole("button", { name: "Drop a disc in column 3" }));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ column: 2 });
  });

  it("marks a full column aria-disabled and relabels it, ignoring clicks on it", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const state = emptyState();
    const board = state.board.map((col) => col.slice());
    board[0] = new Array(ROWS).fill(1);
    render(<ConnectFourBoard state={{ board }} onMove={onMove} disabled={false} lastMove={null} />);

    const fullColumn = screen.getByRole("button", { name: "Column 1, full" });
    expect(fullColumn).toHaveAttribute("aria-disabled", "true");
    expect(fullColumn).not.toBeDisabled();
    await user.click(fullColumn);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("marks all columns aria-disabled and ignores clicks when disabled, without removing them from the tab order", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ConnectFourBoard state={emptyState()} onMove={onMove} disabled lastMove={null} />);

    const columns = screen.getAllByRole("button");
    for (const column of columns) {
      expect(column).toHaveAttribute("aria-disabled", "true");
      expect(column).not.toBeDisabled();
    }

    // The roving-tabindex column must stay keyboard-reachable even while
    // disabled (native `disabled` would yank the whole board out of the tab
    // order, hiding it from keyboard users during a bot's turn).
    expect(columns[0]).toHaveAttribute("tabindex", "0");
    (columns[0] as HTMLElement).focus();
    expect(columns[0]).toHaveFocus();

    await user.click(columns[3] as HTMLElement);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Connect Four board" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("keeps arrow-key navigation working across a disabled board", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ConnectFourBoard state={emptyState()} onMove={onMove} disabled lastMove={null} />);

    const first = screen.getByRole("button", { name: "Drop a disc in column 1" });
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Drop a disc in column 2" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("renders dropped discs bottom-up per column", () => {
    const board = emptyState().board.map((col) => col.slice());
    // Two discs dropped into column 0: player 1 then player 2 (gravity -> rows 0, 1).
    board[0] = [1, 2, null, null, null, null];
    const { container } = render(
      <ConnectFourBoard state={{ board }} onMove={vi.fn()} disabled={false} lastMove={null} />,
    );

    const discs = container.querySelectorAll('[class*="disc"]');
    expect(discs).toHaveLength(2);
  });

  it("highlights the four winning discs when a winningLine is supplied", () => {
    // Horizontal win for player 1 along the bottom row (row 0), columns 0-3.
    // Built functionally (no in-place mutation of the readonly row cells).
    const board = emptyState().board.map((col, column) =>
      col.map((cell, row) => (row === 0 && column <= 3 ? 1 : cell)),
    );
    const { container } = render(
      <ConnectFourBoard
        state={{ board }}
        onMove={vi.fn()}
        disabled
        lastMove={{ move: { column: 3 }, player: 1 }}
        winningLine={[
          { column: 0, row: 0 },
          { column: 1, row: 0 },
          { column: 2, row: 0 },
          { column: 3, row: 0 },
        ]}
      />,
    );

    // Exactly the 4 winning discs carry the highlight class.
    expect(container.querySelectorAll('[class*="winning"]')).toHaveLength(4);
  });

  it("recolors the winning discs red when winningLineTone is 'loss', not the default green", () => {
    const board = emptyState().board.map((col, column) =>
      col.map((cell, row) => (row === 0 && column <= 3 ? 1 : cell)),
    );
    const { container } = render(
      <ConnectFourBoard
        state={{ board }}
        onMove={vi.fn()}
        disabled
        lastMove={{ move: { column: 3 }, player: 1 }}
        winningLine={[
          { column: 0, row: 0 },
          { column: 1, row: 0 },
          { column: 2, row: 0 },
          { column: 3, row: 0 },
        ]}
        winningLineTone="loss"
      />,
    );

    const winningLossDiscs = Array.from(container.querySelectorAll(`.${styles.winningLoss}`));
    expect(winningLossDiscs).toHaveLength(4);
    expect(container.querySelectorAll(`.${styles.winning}`)).toHaveLength(0);
  });

  it("supports arrow-key roving-tabindex navigation between columns", async () => {
    const user = userEvent.setup();
    render(<ConnectFourBoard state={emptyState()} onMove={vi.fn()} disabled={false} lastMove={null} />);

    const first = screen.getByRole("button", { name: "Drop a disc in column 1" });
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Drop a disc in column 2" })).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByRole("button", { name: "Drop a disc in column 7" })).toHaveFocus();
  });
});
