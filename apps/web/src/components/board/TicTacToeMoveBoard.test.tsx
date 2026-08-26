import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TicTacToeMoveState } from "@mpg/engine";
import { TicTacToeMoveBoard } from "./TicTacToeMoveBoard";
import styles from "./TicTacToeMoveBoard.module.css";

function stateWith(board: (1 | 2 | null)[], toMove: 1 | 2 = 1): TicTacToeMoveState {
  return { board, toMove, history: [] };
}

function emptyBoard(): (1 | 2 | null)[] {
  return new Array(9).fill(null);
}

describe("TicTacToeMoveBoard", () => {
  it("placement phase: clicking an empty cell places a piece", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <TicTacToeMoveBoard state={stateWith(emptyBoard())} onMove={onMove} disabled={false} lastMove={null} />,
    );

    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" }));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ kind: "place", cell: 4 });
  });

  it("shows a 'pieces left to place' indicator during placement", () => {
    const board = emptyBoard();
    board[0] = 1; // X has placed 1 of 3
    render(
      <TicTacToeMoveBoard state={stateWith(board)} onMove={vi.fn()} disabled={false} lastMove={null} />,
    );

    expect(screen.getAllByText("2 pieces left to place.").length).toBeGreaterThan(0);
  });

  it("enters move phase (mover has all 3 pieces down) and prompts to select a piece", () => {
    const board = emptyBoard();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1; // X has all 3 down; it's X's turn again (move phase)
    board[3] = 2;
    board[4] = 2;
    board[5] = 2;
    render(
      <TicTacToeMoveBoard state={stateWith(board, 1)} onMove={vi.fn()} disabled={false} lastMove={null} />,
    );

    expect(screen.getAllByText("Select a piece to move.").length).toBeGreaterThan(0);
  });

  it("move phase: selecting an own piece marks it selected and highlights empty targets", async () => {
    const user = userEvent.setup();
    const board = emptyBoard();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1;
    board[3] = 2;
    board[4] = 2;
    board[5] = 2;
    render(
      <TicTacToeMoveBoard state={stateWith(board, 1)} onMove={vi.fn()} disabled={false} lastMove={null} />,
    );

    const ownPiece = screen.getByRole("gridcell", { name: "Row 1, column 1, X" });
    await user.click(ownPiece);

    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, X, selected" })).toBeInTheDocument();
    expect(screen.getAllByText("Choose where to move it — tap it again to cancel.").length).toBeGreaterThan(0);

    const emptyTarget = screen.getByRole("gridcell", { name: "Row 3, column 1, empty" });
    expect(emptyTarget.className).toMatch(new RegExp(styles.validTarget!));
  });

  it("move phase: activating an empty target after selecting a piece issues a relocate move", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const board = emptyBoard();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1;
    board[3] = 2;
    board[4] = 2;
    board[5] = 2;
    render(
      <TicTacToeMoveBoard state={stateWith(board, 1)} onMove={onMove} disabled={false} lastMove={null} />,
    );

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, X" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 3, column 1, empty" }));

    expect(onMove).toHaveBeenCalledExactlyOnceWith({ kind: "relocate", from: 0, to: 6 });
  });

  it("move phase: clicking an opponent's piece before selecting is a no-op", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const board = emptyBoard();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1;
    board[3] = 2;
    board[4] = 2;
    board[5] = 2;
    render(
      <TicTacToeMoveBoard state={stateWith(board, 1)} onMove={onMove} disabled={false} lastMove={null} />,
    );

    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 1, O" }));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getAllByText("Select a piece to move.").length).toBeGreaterThan(0);
  });

  it("move phase: clicking an empty cell before selecting a piece is a no-op", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const board = emptyBoard();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1;
    board[3] = 2;
    board[4] = 2;
    board[5] = 2;
    render(
      <TicTacToeMoveBoard state={stateWith(board, 1)} onMove={onMove} disabled={false} lastMove={null} />,
    );

    await user.click(screen.getByRole("gridcell", { name: "Row 3, column 1, empty" }));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getAllByText("Select a piece to move.").length).toBeGreaterThan(0);
  });

  it("move phase: re-activating the selected piece deselects it", async () => {
    const user = userEvent.setup();
    const board = emptyBoard();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1;
    board[3] = 2;
    board[4] = 2;
    board[5] = 2;
    render(
      <TicTacToeMoveBoard state={stateWith(board, 1)} onMove={vi.fn()} disabled={false} lastMove={null} />,
    );

    const ownPiece = screen.getByRole("gridcell", { name: "Row 1, column 1, X" });
    await user.click(ownPiece);
    expect(screen.getAllByText("Choose where to move it — tap it again to cancel.").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, X, selected" }));
    expect(screen.getAllByText("Select a piece to move.").length).toBeGreaterThan(0);
  });

  it("move phase: pressing Escape while a piece is selected deselects it", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const board = emptyBoard();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1;
    board[3] = 2;
    board[4] = 2;
    board[5] = 2;
    render(
      <TicTacToeMoveBoard state={stateWith(board, 1)} onMove={onMove} disabled={false} lastMove={null} />,
    );

    const ownPiece = screen.getByRole("gridcell", { name: "Row 1, column 1, X" });
    await user.click(ownPiece);
    expect(screen.getAllByText("Choose where to move it — tap it again to cancel.").length).toBeGreaterThan(0);

    await user.keyboard("{Escape}");
    expect(screen.getAllByText("Select a piece to move.").length).toBeGreaterThan(0);
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, X" })).toBeInTheDocument();

    // Escape only cleared selection state, no move was ever issued.
    await user.click(screen.getByRole("gridcell", { name: "Row 3, column 1, empty" }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("move phase: it is the opponent's turn (board disabled) — clicking own pieces, opponent pieces, and empty cells are all no-ops", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const board = emptyBoard();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1;
    board[3] = 2;
    board[4] = 2;
    board[5] = 2;
    // toMove is O (player 2), but from this local human's (X's) perspective the
    // board is `disabled` because it isn't their turn.
    render(
      <TicTacToeMoveBoard state={stateWith(board, 2)} onMove={onMove} disabled lastMove={null} />,
    );

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, X" })); // own piece
    await user.click(screen.getByRole("gridcell", { name: "Row 2, column 1, O" })); // opponent's piece (the mover)
    await user.click(screen.getByRole("gridcell", { name: "Row 3, column 1, empty" })); // empty cell

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-disabled", "true");
  });

  it("move phase: selecting a different own piece re-selects instead of moving", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const board = emptyBoard();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1;
    board[3] = 2;
    board[4] = 2;
    board[5] = 2;
    render(
      <TicTacToeMoveBoard state={stateWith(board, 1)} onMove={onMove} disabled={false} lastMove={null} />,
    );

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, X" }));
    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 2, X" }));

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("gridcell", { name: "Row 1, column 2, X, selected" })).toBeInTheDocument();
  });

  it("marks every cell aria-disabled and ignores clicks when disabled, without removing them from the tab order", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <TicTacToeMoveBoard state={stateWith(emptyBoard())} onMove={onMove} disabled lastMove={null} />,
    );

    const cells = screen.getAllByRole("gridcell");
    for (const cell of cells) {
      expect(cell).toHaveAttribute("aria-disabled", "true");
      expect(cell).not.toBeDisabled();
    }

    expect(cells[0]).toHaveAttribute("tabindex", "0");
    (cells[0] as HTMLElement).focus();
    expect(cells[0]).toHaveFocus();

    await user.click(cells[4] as HTMLElement);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-disabled", "true");
  });

  it("disabled move-phase board: clicking an own piece does not select it", async () => {
    const user = userEvent.setup();
    const board = emptyBoard();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1;
    board[3] = 2;
    board[4] = 2;
    board[5] = 2;
    render(
      <TicTacToeMoveBoard state={stateWith(board, 1)} onMove={vi.fn()} disabled lastMove={null} />,
    );

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, X" }));
    expect(screen.queryAllByText("Choose where to move it — tap it again to cancel.")).toHaveLength(0);
  });

  it("highlights the three winning cells when a winningLine is supplied", () => {
    const board = emptyBoard();
    board[0] = 1;
    board[1] = 1;
    board[2] = 1; // X wins the top row
    render(
      <TicTacToeMoveBoard
        state={stateWith(board)}
        onMove={vi.fn()}
        disabled
        lastMove={{ move: { kind: "place", cell: 2 }, player: 1 }}
        winningLine={[0, 1, 2]}
      />,
    );

    for (const name of ["Row 1, column 1, X", "Row 1, column 2, X", "Row 1, column 3, X"]) {
      expect(screen.getByRole("gridcell", { name }).className).toMatch(/winning/);
    }
    expect(screen.getByRole("gridcell", { name: "Row 3, column 1, empty" }).className).not.toMatch(
      /winning/,
    );
  });

  it("supports arrow-key roving-tabindex navigation between cells", async () => {
    const user = userEvent.setup();
    render(
      <TicTacToeMoveBoard state={stateWith(emptyBoard())} onMove={vi.fn()} disabled={false} lastMove={null} />,
    );

    const first = screen.getByRole("gridcell", { name: "Row 1, column 1, empty" });
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("gridcell", { name: "Row 1, column 2, empty" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("gridcell", { name: "Row 2, column 2, empty" })).toHaveFocus();
  });
});
