import { describe, it, expect } from "vitest";
import type { TicTacToeMoveState, TicTacToeMoveMove } from "./tictactoe-move";
import { ticTacToeMove } from "./tictactoe-move";
import { IllegalMoveError } from "./errors";
import type { Player } from "./types";

const PLAYER_X = 1;
const PLAYER_O = 2;

/** Plays a sequence of moves through the real `applyMove`, alternating X then O. */
function play(moves: readonly TicTacToeMoveMove[]): TicTacToeMoveState {
  let state = ticTacToeMove.createInitialState();
  moves.forEach((move, i) => {
    const player = i % 2 === 0 ? PLAYER_X : PLAYER_O;
    state = ticTacToeMove.applyMove(state, move, player);
  });
  return state;
}

function place(cell: number): TicTacToeMoveMove {
  return { kind: "place", cell };
}

function relocate(from: number, to: number): TicTacToeMoveMove {
  return { kind: "relocate", from, to };
}

describe("tictactoe-move: placement phase", () => {
  it("returns all 9 empty cells as legal placements on a fresh board", () => {
    const moves = ticTacToeMove.legalMoves(ticTacToeMove.createInitialState());
    expect(moves).toHaveLength(9);
    expect(moves.every((m) => m.kind === "place")).toBe(true);
  });

  it("X placing 3-in-a-row during placement wins with the correct line", () => {
    // X: 0, 1, 2 (row 0); O: 3, 4 (only 2 down, doesn't matter).
    const state = play([place(0), place(3), place(1), place(4), place(2)]);
    expect(ticTacToeMove.getResult(state)).toEqual({
      status: "win",
      winner: PLAYER_X,
      line: [0, 1, 2],
    });
  });
});

describe("tictactoe-move: phase transition", () => {
  it("switches to relocation moves once a side has placed all 3 pieces", () => {
    // Non-winning placements for both sides: X ends at 0,3,7 ; O ends at 1,4,6.
    let state = play([place(0), place(1), place(3), place(4), place(7)]);
    // Now it's O's turn with 2 down -> still placement for O.
    let moves = ticTacToeMove.legalMoves(state);
    expect(moves.every((m) => m.kind === "place")).toBe(true);

    state = ticTacToeMove.applyMove(state, place(6), PLAYER_O);
    // Now X's turn, X has all 3 down -> relocation only.
    moves = ticTacToeMove.legalMoves(state);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.kind === "relocate")).toBe(true);
  });

  it("rejects a placement once the mover already has 3 pieces down", () => {
    const state = play([place(0), place(1), place(3), place(4), place(7), place(6)]);
    // X's turn, X has 3 down; X tries to place instead of relocate.
    expect(() => ticTacToeMove.applyMove(state, place(2), PLAYER_X)).toThrow(IllegalMoveError);
    try {
      ticTacToeMove.applyMove(state, place(2), PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("illegal_move");
    }
  });
});

describe("tictactoe-move: move phase", () => {
  it("a relocation that completes a line wins with the correct winner and line", () => {
    // X: 0,1,5 ; O: 3,4,7 (both have 3 down, X to move). Relocating X's 5 -> 2
    // completes row 0 (0,1,2).
    const state = play([place(0), place(3), place(1), place(4), place(5), place(7)]);
    expect(ticTacToeMove.currentPlayer(state)).toBe(PLAYER_X);
    const next = ticTacToeMove.applyMove(state, relocate(5, 2), PLAYER_X);
    expect(ticTacToeMove.getResult(next)).toEqual({
      status: "win",
      winner: PLAYER_X,
      line: [0, 1, 2],
    });
  });

  it("allows relocating to any empty cell, not just an adjacent one", () => {
    // X: 0,1,5 ; O: 3,4,7 ; X to move. Cell 8 is empty and non-adjacent to 0.
    const state = play([place(0), place(3), place(1), place(4), place(5), place(7)]);
    const moves = ticTacToeMove.legalMoves(state);
    expect(moves).toContainEqual({ kind: "relocate", from: 0, to: 8 });
    const next = ticTacToeMove.applyMove(state, relocate(0, 8), PLAYER_X);
    expect(next.board[0]).toBeNull();
    expect(next.board[8]).toBe(PLAYER_X);
  });
});

describe("tictactoe-move: illegal moves", () => {
  it("rejects a move played out of turn (not_your_turn)", () => {
    const state = ticTacToeMove.createInitialState();
    expect(() => ticTacToeMove.applyMove(state, place(0), PLAYER_O)).toThrow(IllegalMoveError);
    try {
      ticTacToeMove.applyMove(state, place(0), PLAYER_O);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("not_your_turn");
    }
  });

  it("rejects a relocation attempted before the mover has 3 pieces down (illegal_move)", () => {
    const state = play([place(0)]);
    // O's turn, O has 0 down; O attempts to relocate.
    expect(() => ticTacToeMove.applyMove(state, relocate(0, 1), PLAYER_O)).toThrow(
      IllegalMoveError
    );
    try {
      ticTacToeMove.applyMove(state, relocate(0, 1), PLAYER_O);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("illegal_move");
    }
  });

  it("rejects relocating from a cell the mover does not own (illegal_move)", () => {
    const state = play([place(0), place(1), place(3), place(4), place(7), place(6)]);
    // X's turn, X owns 0,3,7; X tries to relocate O's cell 1.
    expect(() => ticTacToeMove.applyMove(state, relocate(1, 2), PLAYER_X)).toThrow(
      IllegalMoveError
    );
    try {
      ticTacToeMove.applyMove(state, relocate(1, 2), PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("illegal_move");
    }
  });

  it("rejects relocating from an empty cell (illegal_move)", () => {
    const state = play([place(0), place(1), place(3), place(4), place(7), place(6)]);
    expect(() => ticTacToeMove.applyMove(state, relocate(2, 5), PLAYER_X)).toThrow(
      IllegalMoveError
    );
    try {
      ticTacToeMove.applyMove(state, relocate(2, 5), PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("illegal_move");
    }
  });

  it("rejects relocating onto an occupied cell (illegal_move)", () => {
    const state = play([place(0), place(1), place(3), place(4), place(7), place(6)]);
    expect(() => ticTacToeMove.applyMove(state, relocate(0, 1), PLAYER_X)).toThrow(
      IllegalMoveError
    );
    try {
      ticTacToeMove.applyMove(state, relocate(0, 1), PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("illegal_move");
    }
  });

  it("rejects placing onto an occupied cell (illegal_move)", () => {
    const state = play([place(0)]);
    expect(() => ticTacToeMove.applyMove(state, place(0), PLAYER_O)).toThrow(IllegalMoveError);
    try {
      ticTacToeMove.applyMove(state, place(0), PLAYER_O);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("illegal_move");
    }
  });

  it.each([-1, 9, 100])("rejects an out-of-bounds place cell (%i)", (cell) => {
    const state = ticTacToeMove.createInitialState();
    expect(() => ticTacToeMove.applyMove(state, place(cell), PLAYER_X)).toThrow(
      IllegalMoveError
    );
    try {
      ticTacToeMove.applyMove(state, place(cell), PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("out_of_bounds");
    }
  });

  it("rejects an out-of-bounds relocation `from`/`to`", () => {
    const state = play([place(0), place(1), place(3), place(4), place(7), place(6)]);
    expect(() => ticTacToeMove.applyMove(state, relocate(-1, 2), PLAYER_X)).toThrow(
      IllegalMoveError
    );
    try {
      ticTacToeMove.applyMove(state, relocate(-1, 2), PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("out_of_bounds");
    }

    expect(() => ticTacToeMove.applyMove(state, relocate(0, 9), PLAYER_X)).toThrow(
      IllegalMoveError
    );
    try {
      ticTacToeMove.applyMove(state, relocate(0, 9), PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("out_of_bounds");
    }
  });

  it("rejects any move after the game has ended (game_over)", () => {
    const state = play([place(0), place(3), place(1), place(4), place(2)]); // X wins row 0
    expect(ticTacToeMove.getResult(state).status).toBe("win");
    expect(() => ticTacToeMove.applyMove(state, place(5), PLAYER_O)).toThrow(IllegalMoveError);
    try {
      ticTacToeMove.applyMove(state, place(5), PLAYER_O);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("game_over");
    }
  });
});

describe("tictactoe-move: threefold repetition draw", () => {
  it("declares a draw when the same position (board + side to move) recurs 3 times", () => {
    // Both sides place 3 pieces without winning: X 0,3,7 ; O 1,4,6. Cells 2,5,8 stay empty.
    const state = play([place(0), place(1), place(3), place(4), place(7), place(6)]);
    // Now X to move, both fully placed. Shuffle X's piece at 7 out to 8 and back, and O's
    // piece at 6 out to 5 and back, repeatedly returning to the same position with X to
    // move. Each full cycle (X out, O out, X back, O back) reproduces the starting position.
    expect(ticTacToeMove.currentPlayer(state)).toBe(PLAYER_X);
    expect(ticTacToeMove.getResult(state).status).toBe("in_progress");

    const cycle: TicTacToeMoveMove[] = [
      relocate(7, 8), // X: 0,3,8
      relocate(6, 5), // O: 1,4,5
      relocate(8, 7), // X: 0,3,7 (back to original)
      relocate(5, 6), // O: 1,4,6 (back to original) -> position recurs
    ];

    let s = state;
    const players: readonly Player[] = [PLAYER_X, PLAYER_O, PLAYER_X, PLAYER_O];
    function runCycle(): void {
      cycle.forEach((move, i) => {
        s = ticTacToeMove.applyMove(s, move, players[i] as Player);
      });
    }

    // First cycle: returns to the original position for its 2nd occurrence.
    runCycle();
    expect(ticTacToeMove.getResult(s).status).toBe("in_progress");

    // Second cycle: returns to the original position for its 3rd occurrence -> draw.
    runCycle();
    expect(ticTacToeMove.getResult(s)).toEqual({ status: "draw", reason: "repetition" });
  });
});

describe("tictactoe-move: currentPlayer alternation", () => {
  it("alternates through both the placement and move phases", () => {
    let state = ticTacToeMove.createInitialState();
    expect(ticTacToeMove.currentPlayer(state)).toBe(PLAYER_X);

    state = ticTacToeMove.applyMove(state, place(0), PLAYER_X);
    expect(ticTacToeMove.currentPlayer(state)).toBe(PLAYER_O);

    state = ticTacToeMove.applyMove(state, place(3), PLAYER_O);
    expect(ticTacToeMove.currentPlayer(state)).toBe(PLAYER_X);

    state = ticTacToeMove.applyMove(state, place(1), PLAYER_X);
    state = ticTacToeMove.applyMove(state, place(4), PLAYER_O);
    state = ticTacToeMove.applyMove(state, place(6), PLAYER_X); // X now has 3 down: {0,1,6}
    expect(ticTacToeMove.currentPlayer(state)).toBe(PLAYER_O);

    state = ticTacToeMove.applyMove(state, place(8), PLAYER_O); // O now has 3 down: {3,4,8}
    expect(ticTacToeMove.currentPlayer(state)).toBe(PLAYER_X);

    // Both fully placed: relocation phase continues to alternate.
    state = ticTacToeMove.applyMove(state, relocate(6, 5), PLAYER_X);
    expect(ticTacToeMove.currentPlayer(state)).toBe(PLAYER_O);
  });
});
