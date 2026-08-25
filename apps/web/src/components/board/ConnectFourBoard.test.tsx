import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConnectFourState } from "@mpg/engine";
import { ConnectFourBoard } from "./ConnectFourBoard";

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
    expect(screen.getByRole("button", { name: "Drop a disc in column 1" })).toBeEnabled();
  });

  it("calls onMove with the clicked column", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ConnectFourBoard state={emptyState()} onMove={onMove} disabled={false} lastMove={null} />);

    await user.click(screen.getByRole("button", { name: "Drop a disc in column 3" }));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ column: 2 });
  });

  it("disables and relabels a full column, and ignores clicks on it", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const state = emptyState();
    const board = state.board.map((col) => col.slice());
    board[0] = new Array(ROWS).fill(1);
    render(<ConnectFourBoard state={{ board }} onMove={onMove} disabled={false} lastMove={null} />);

    const fullColumn = screen.getByRole("button", { name: "Column 1, full" });
    expect(fullColumn).toBeDisabled();
    await user.click(fullColumn);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("disables all columns and ignores clicks when disabled", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ConnectFourBoard state={emptyState()} onMove={onMove} disabled lastMove={null} />);

    const columns = screen.getAllByRole("button");
    for (const column of columns) expect(column).toBeDisabled();

    await user.click(columns[3] as HTMLElement);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Connect Four board" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
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
