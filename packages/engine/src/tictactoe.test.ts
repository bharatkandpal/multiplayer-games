import { describe, it, expect } from "vitest";
import type { TicTacToeState } from "./tictactoe";
import { ticTacToe } from "./tictactoe";
import { IllegalMoveError } from "./errors";

const PLAYER_X = 1;
const PLAYER_O = 2;

/**
 * Plays a sequence of cell indices through the real `applyMove`, alternating
 * X (player 1, moves first) and O (player 2). Returns the resulting state.
 * This exercises win/draw detection via legitimate turn-respecting play
 * rather than by hand-constructing internal state.
 */
function play(cells: readonly number[]): TicTacToeState {
  let state = ticTacToe.createInitialState();
  cells.forEach((cell, i) => {
    const player = i % 2 === 0 ? PLAYER_X : PLAYER_O;
    state = ticTacToe.applyMove(state, { cell }, player);
  });
  return state;
}

describe("tictactoe: win detection — all 8 lines", () => {
  it.each([
    { name: "row 0 (0,1,2)", cells: [0, 3, 1, 4, 2], winner: PLAYER_X, line: [0, 1, 2] },
    { name: "row 1 (3,4,5)", cells: [3, 0, 4, 1, 5], winner: PLAYER_X, line: [3, 4, 5] },
    { name: "row 2 (6,7,8)", cells: [6, 0, 7, 1, 8], winner: PLAYER_X, line: [6, 7, 8] },
    { name: "col 0 (0,3,6)", cells: [0, 1, 3, 2, 6], winner: PLAYER_X, line: [0, 3, 6] },
    { name: "col 1 (1,4,7)", cells: [1, 0, 4, 2, 7], winner: PLAYER_X, line: [1, 4, 7] },
    { name: "col 2 (2,5,8)", cells: [2, 0, 5, 1, 8], winner: PLAYER_X, line: [2, 5, 8] },
    { name: "diagonal (0,4,8)", cells: [0, 1, 4, 2, 8], winner: PLAYER_X, line: [0, 4, 8] },
    { name: "anti-diagonal (2,4,6)", cells: [2, 0, 4, 1, 6], winner: PLAYER_X, line: [2, 4, 6] },
  ])("detects a win on $name", ({ cells, winner, line }) => {
    const state = play(cells);
    expect(ticTacToe.getResult(state)).toEqual({ status: "win", winner, line });
  });

  it("also detects a win for player O (not just whoever moves first)", () => {
    // X plays 0, 3, 8; O plays 1, 4, 7 -> O completes column 1 (1,4,7).
    const state = play([0, 1, 3, 4, 8, 7]);
    expect(ticTacToe.getResult(state)).toEqual({
      status: "win",
      winner: PLAYER_O,
      line: [1, 4, 7],
    });
  });
});

describe("tictactoe: draw detection", () => {
  it("reports a draw for a full board with no line", () => {
    // Final board:
    // X O X
    // X O O
    // O X X
    // No row, column, or diagonal is a single mark the whole way — verified below.
    const state = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(state.board).toEqual([
      PLAYER_X,
      PLAYER_O,
      PLAYER_X,
      PLAYER_X,
      PLAYER_O,
      PLAYER_O,
      PLAYER_O,
      PLAYER_X,
      PLAYER_X,
    ]);
    expect(ticTacToe.getResult(state)).toEqual({ status: "draw", reason: "board-full" });
  });
});

describe("tictactoe: in-progress detection", () => {
  it("reports in_progress for a fresh board", () => {
    expect(ticTacToe.getResult(ticTacToe.createInitialState())).toEqual({
      status: "in_progress",
    });
  });

  it("reports in_progress for a partial board with no line yet", () => {
    const state = play([0, 4, 1]);
    expect(ticTacToe.getResult(state)).toEqual({ status: "in_progress" });
  });
});

describe("tictactoe: legalMoves", () => {
  it("returns all 9 empty cells on a fresh board", () => {
    const moves = ticTacToe.legalMoves(ticTacToe.createInitialState());
    expect(moves).toHaveLength(9);
    expect(moves.map((m) => m.cell).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("returns only the remaining empty cells on a partial board", () => {
    const state = play([0, 4, 8]); // X:0,8 O:4
    const moves = ticTacToe.legalMoves(state);
    expect(moves.map((m) => m.cell).sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 6, 7]);
  });

  it("returns no legal moves once the game has been won", () => {
    const state = play([0, 3, 1, 4, 2]); // X wins row 0
    expect(ticTacToe.legalMoves(state)).toEqual([]);
  });

  it("returns no legal moves once the game is a draw", () => {
    const state = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(ticTacToe.legalMoves(state)).toEqual([]);
  });
});

describe("tictactoe: currentPlayer alternation", () => {
  it("starts with X (player 1) and alternates after each move", () => {
    let state = ticTacToe.createInitialState();
    expect(ticTacToe.currentPlayer(state)).toBe(PLAYER_X);

    state = ticTacToe.applyMove(state, { cell: 0 }, PLAYER_X);
    expect(ticTacToe.currentPlayer(state)).toBe(PLAYER_O);

    state = ticTacToe.applyMove(state, { cell: 1 }, PLAYER_O);
    expect(ticTacToe.currentPlayer(state)).toBe(PLAYER_X);

    state = ticTacToe.applyMove(state, { cell: 4 }, PLAYER_X);
    expect(ticTacToe.currentPlayer(state)).toBe(PLAYER_O);
  });
});

describe("tictactoe: applyMove rejections", () => {
  it("rejects a move onto an already-occupied cell with reason illegal_move", () => {
    let state = ticTacToe.createInitialState();
    state = ticTacToe.applyMove(state, { cell: 0 }, PLAYER_X);
    state = ticTacToe.applyMove(state, { cell: 1 }, PLAYER_O);
    // It's X's turn again; X attempts the cell X already occupied.
    expect(() => ticTacToe.applyMove(state, { cell: 0 }, PLAYER_X)).toThrow(IllegalMoveError);
    try {
      ticTacToe.applyMove(state, { cell: 0 }, PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("illegal_move");
    }
  });

  it("rejects a move played out of turn with reason not_your_turn", () => {
    const state = ticTacToe.createInitialState();
    // It's X's (player 1) turn; player 2 tries to move.
    expect(() => ticTacToe.applyMove(state, { cell: 0 }, PLAYER_O)).toThrow(IllegalMoveError);
    try {
      ticTacToe.applyMove(state, { cell: 0 }, PLAYER_O);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("not_your_turn");
    }
  });

  it("rejects a move played by the wrong player mid-game with reason not_your_turn", () => {
    let state = ticTacToe.createInitialState();
    state = ticTacToe.applyMove(state, { cell: 0 }, PLAYER_X);
    // Now it's O's turn; X tries to move again.
    expect(() => ticTacToe.applyMove(state, { cell: 1 }, PLAYER_X)).toThrow(IllegalMoveError);
    try {
      ticTacToe.applyMove(state, { cell: 1 }, PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("not_your_turn");
    }
  });

  it.each([-1, 9, 100])("rejects a cell out of 0..8 (%i) with reason out_of_bounds", (cell) => {
    const state = ticTacToe.createInitialState();
    expect(() => ticTacToe.applyMove(state, { cell }, PLAYER_X)).toThrow(IllegalMoveError);
    try {
      ticTacToe.applyMove(state, { cell }, PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("out_of_bounds");
    }
  });

  it("rejects a non-integer cell with reason out_of_bounds", () => {
    const state = ticTacToe.createInitialState();
    expect(() => ticTacToe.applyMove(state, { cell: 1.5 }, PLAYER_X)).toThrow(IllegalMoveError);
    try {
      ticTacToe.applyMove(state, { cell: 1.5 }, PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("out_of_bounds");
    }
  });

  it("rejects any move after a win with reason game_over", () => {
    const state = play([0, 3, 1, 4, 2]); // X wins row 0
    expect(() => ticTacToe.applyMove(state, { cell: 5 }, PLAYER_O)).toThrow(IllegalMoveError);
    try {
      ticTacToe.applyMove(state, { cell: 5 }, PLAYER_O);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("game_over");
    }
  });

  it("rejects any move after a draw with reason game_over", () => {
    const state = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(() => ticTacToe.applyMove(state, { cell: 0 }, PLAYER_X)).toThrow(IllegalMoveError);
    try {
      ticTacToe.applyMove(state, { cell: 0 }, PLAYER_X);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("game_over");
    }
  });
});

describe("tictactoe: immutability", () => {
  it("does not mutate the input state when applying a move", () => {
    const initial = ticTacToe.createInitialState();
    const before = initial.board.slice();

    const next = ticTacToe.applyMove(initial, { cell: 4 }, PLAYER_X);

    expect(initial.board).toEqual(before);
    expect(initial.board[4]).toBeNull();
    expect(next.board[4]).toBe(PLAYER_X);
    expect(next).not.toBe(initial);
    expect(next.board).not.toBe(initial.board);
  });

  it("leaves earlier states in a played-out sequence untouched", () => {
    const s0 = ticTacToe.createInitialState();
    const s1 = ticTacToe.applyMove(s0, { cell: 0 }, PLAYER_X);
    const s2 = ticTacToe.applyMove(s1, { cell: 1 }, PLAYER_O);

    expect(s0.board.every((c) => c === null)).toBe(true);
    expect(s1.board[0]).toBe(PLAYER_X);
    expect(s1.board[1]).toBeNull();
    expect(s2.board[0]).toBe(PLAYER_X);
    expect(s2.board[1]).toBe(PLAYER_O);
  });
});
