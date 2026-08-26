import { describe, it, expect } from "vitest";
import type { ConnectFourState } from "./connect4";
import { connectFour } from "./connect4";
import { IllegalMoveError } from "./errors";

const PLAYER_ONE = 1;
const PLAYER_TWO = 2;

/**
 * Plays a sequence of column drops through the real `applyMove`, alternating
 * player 1 and player 2 (player 1 moves first). Returns the resulting state.
 * This exercises win/draw/gravity detection via legitimate turn-respecting
 * play rather than by hand-constructing internal state.
 */
function play(columns: readonly number[]): ConnectFourState {
  let state = connectFour.createInitialState();
  columns.forEach((column, i) => {
    const player = i % 2 === 0 ? PLAYER_ONE : PLAYER_TWO;
    state = connectFour.applyMove(state, { column }, player);
  });
  return state;
}

describe("connect4: win detection — all 4 orientations", () => {
  it("detects a horizontal win (row 0, columns 0-3) for player 1", () => {
    // P1: col0,col1,col2,col3 (all row 0). P2 stacks a second disc on col0-2
    // in between, never completing a line of its own.
    const state = play([0, 0, 1, 1, 2, 2, 3]);
    expect(connectFour.getResult(state)).toEqual({
      status: "win",
      winner: PLAYER_ONE,
      line: [
        { column: 0, row: 0 },
        { column: 1, row: 0 },
        { column: 2, row: 0 },
        { column: 3, row: 0 },
      ],
    });
  });

  it("detects a vertical win (column 0, rows 0-3) for player 1", () => {
    // P1 drops into col0 four times; P2 drops into col1 in between (only 3
    // discs there — no vertical win of its own).
    const state = play([0, 1, 0, 1, 0, 1, 0]);
    expect(connectFour.getResult(state)).toEqual({
      status: "win",
      winner: PLAYER_ONE,
      line: [
        { column: 0, row: 0 },
        { column: 0, row: 1 },
        { column: 0, row: 2 },
        { column: 0, row: 3 },
      ],
    });
  });

  it("detects an up-right diagonal (↗) win for player 1", () => {
    // Builds P1 discs at (0,0),(1,1),(2,2),(3,3) by stacking the required
    // filler discs underneath each target cell, respecting strict turn order.
    // Final board (col: bottom→top), '.' = empty:
    //   col0: [P1]
    //   col1: [P2,P1]
    //   col2: [P2,P1,P1]
    //   col3: [P2,P1,P2,P1]
    //   col6: [P2]
    const state = play([0, 1, 1, 2, 2, 6, 2, 3, 3, 3, 3]);
    expect(connectFour.getResult(state)).toEqual({
      status: "win",
      winner: PLAYER_ONE,
      line: [
        { column: 0, row: 0 },
        { column: 1, row: 1 },
        { column: 2, row: 2 },
        { column: 3, row: 3 },
      ],
    });
  });

  it("detects a down-right diagonal (↘) win for player 2 (not just player 1)", () => {
    // Builds P2 discs at (3,0),(2,1),(1,2),(0,3) by stacking the required
    // filler discs underneath/around each target cell.
    // Final board (col: bottom→top):
    //   col0: [P1,P2,P1,P2]
    //   col1: [P1,P2,P2]
    //   col2: [P1,P2]
    //   col3: [P2]
    //   col4: [P1]
    //   col5: [P1]
    const state = play([4, 3, 2, 2, 1, 1, 5, 1, 0, 0, 0, 0]);
    expect(connectFour.getResult(state)).toEqual({
      status: "win",
      winner: PLAYER_TWO,
      line: [
        { column: 0, row: 3 },
        { column: 1, row: 2 },
        { column: 2, row: 1 },
        { column: 3, row: 0 },
      ],
    });
  });
});

describe("connect4: draw detection", () => {
  it("reports a draw for a completely full board with no four-in-a-row", () => {
    // Verified (via exhaustive backtracking search over the real engine) to
    // fill all 42 cells without ever producing a four-in-a-row.
    const columns = [
      3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 0, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5, 5, 5,
      0, 0, 0, 0, 0, 6, 6, 6, 6, 6, 6,
    ];
    const state = play(columns);

    expect(state.board.every((col) => col.every((cell) => cell !== null))).toBe(true);
    expect(connectFour.getResult(state)).toEqual({ status: "draw", reason: "board-full" });
  });
});

describe("connect4: in-progress detection", () => {
  it("reports in_progress for a fresh board", () => {
    expect(connectFour.getResult(connectFour.createInitialState())).toEqual({
      status: "in_progress",
    });
  });

  it("reports in_progress for a partial board with no line yet", () => {
    const state = play([0, 1, 2, 3, 4]);
    expect(connectFour.getResult(state)).toEqual({ status: "in_progress" });
  });
});

describe("connect4: gravity / stacking", () => {
  it("stacks discs in a column on top of existing discs, lowest row first", () => {
    const state = play([2, 2, 2]);
    expect(state.board[2]).toEqual([PLAYER_ONE, PLAYER_TWO, PLAYER_ONE, null, null, null]);
    // Untouched columns remain fully empty.
    expect(state.board[0]).toEqual([null, null, null, null, null, null]);
  });

  it("excludes a full column from legalMoves but keeps other columns available", () => {
    // Fill column 0 completely (6 discs, alternating players).
    const state = play([0, 0, 0, 0, 0, 0]);
    expect(state.board[0]).toEqual([
      PLAYER_ONE,
      PLAYER_TWO,
      PLAYER_ONE,
      PLAYER_TWO,
      PLAYER_ONE,
      PLAYER_TWO,
    ]);

    const moves = connectFour.legalMoves(state);
    expect(moves.map((m) => m.column)).not.toContain(0);
    expect(moves.map((m) => m.column).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("connect4: legalMoves", () => {
  it("returns all 7 columns on a fresh board", () => {
    const moves = connectFour.legalMoves(connectFour.createInitialState());
    expect(moves.map((m) => m.column).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("returns no legal moves once the game has been won", () => {
    const state = play([0, 0, 1, 1, 2, 2, 3]); // P1 wins row 0
    expect(connectFour.legalMoves(state)).toEqual([]);
  });

  it("returns no legal moves once the game is a draw", () => {
    const columns = [
      3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 0, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5, 5, 5,
      0, 0, 0, 0, 0, 6, 6, 6, 6, 6, 6,
    ];
    const state = play(columns);
    expect(connectFour.legalMoves(state)).toEqual([]);
  });
});

describe("connect4: currentPlayer alternation", () => {
  it("starts with player 1 and alternates after each move", () => {
    let state = connectFour.createInitialState();
    expect(connectFour.currentPlayer(state)).toBe(PLAYER_ONE);

    state = connectFour.applyMove(state, { column: 0 }, PLAYER_ONE);
    expect(connectFour.currentPlayer(state)).toBe(PLAYER_TWO);

    state = connectFour.applyMove(state, { column: 1 }, PLAYER_TWO);
    expect(connectFour.currentPlayer(state)).toBe(PLAYER_ONE);

    state = connectFour.applyMove(state, { column: 0 }, PLAYER_ONE);
    expect(connectFour.currentPlayer(state)).toBe(PLAYER_TWO);
  });
});

describe("connect4: applyMove rejections", () => {
  it("rejects a drop into a full column with reason illegal_move", () => {
    const state = play([0, 0, 0, 0, 0, 0]); // column 0 has all 6 rows filled
    const nextPlayer = connectFour.currentPlayer(state);
    expect(() => connectFour.applyMove(state, { column: 0 }, nextPlayer)).toThrow(IllegalMoveError);
    try {
      connectFour.applyMove(state, { column: 0 }, nextPlayer);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("illegal_move");
    }
  });

  it("rejects a move played out of turn (before any move) with reason not_your_turn", () => {
    const state = connectFour.createInitialState();
    // It's player 1's turn; player 2 tries to move.
    expect(() => connectFour.applyMove(state, { column: 0 }, PLAYER_TWO)).toThrow(IllegalMoveError);
    try {
      connectFour.applyMove(state, { column: 0 }, PLAYER_TWO);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("not_your_turn");
    }
  });

  it("rejects a move played by the wrong player mid-game with reason not_your_turn", () => {
    const state = play([0]); // now it's player 2's turn
    expect(() => connectFour.applyMove(state, { column: 1 }, PLAYER_ONE)).toThrow(IllegalMoveError);
    try {
      connectFour.applyMove(state, { column: 1 }, PLAYER_ONE);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("not_your_turn");
    }
  });

  it.each([-1, 7, 100])("rejects a column out of 0..6 (%i) with reason out_of_bounds", (column) => {
    const state = connectFour.createInitialState();
    expect(() => connectFour.applyMove(state, { column }, PLAYER_ONE)).toThrow(IllegalMoveError);
    try {
      connectFour.applyMove(state, { column }, PLAYER_ONE);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("out_of_bounds");
    }
  });

  it("rejects a non-integer column with reason out_of_bounds", () => {
    const state = connectFour.createInitialState();
    expect(() => connectFour.applyMove(state, { column: 2.5 }, PLAYER_ONE)).toThrow(
      IllegalMoveError,
    );
    try {
      connectFour.applyMove(state, { column: 2.5 }, PLAYER_ONE);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("out_of_bounds");
    }
  });

  it("rejects any move after a win with reason game_over", () => {
    const state = play([0, 0, 1, 1, 2, 2, 3]); // P1 wins row 0 on move 7 (P1's turn)
    // The game is already over, so the rejection reason is game_over regardless
    // of which player is named — but the count is odd here, so it's genuinely P2's turn.
    expect(() => connectFour.applyMove(state, { column: 4 }, PLAYER_TWO)).toThrow(IllegalMoveError);
    try {
      connectFour.applyMove(state, { column: 4 }, PLAYER_TWO);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("game_over");
    }
  });

  it("rejects any move after a draw with reason game_over", () => {
    const columns = [
      3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 0, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5, 5, 5,
      0, 0, 0, 0, 0, 6, 6, 6, 6, 6, 6,
    ];
    const state = play(columns);
    expect(() => connectFour.applyMove(state, { column: 0 }, PLAYER_ONE)).toThrow(IllegalMoveError);
    try {
      connectFour.applyMove(state, { column: 0 }, PLAYER_ONE);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("game_over");
    }
  });
});

describe("connect4: immutability", () => {
  it("does not mutate the input state (or its nested columns) when applying a move", () => {
    const initial = connectFour.createInitialState();
    const beforeBoard = initial.board.map((col) => col.slice());

    const next = connectFour.applyMove(initial, { column: 3 }, PLAYER_ONE);

    expect(initial.board).toEqual(beforeBoard);
    expect(initial.board[3]).toEqual([null, null, null, null, null, null]);
    expect(next.board[3]).toEqual([PLAYER_ONE, null, null, null, null, null]);
    expect(next).not.toBe(initial);
    expect(next.board).not.toBe(initial.board);
    expect(next.board[3]).not.toBe(initial.board[3]);
  });

  it("leaves earlier states in a played-out sequence untouched", () => {
    const s0 = connectFour.createInitialState();
    const s1 = connectFour.applyMove(s0, { column: 2 }, PLAYER_ONE);
    const s2 = connectFour.applyMove(s1, { column: 2 }, PLAYER_TWO);

    expect(s0.board.every((col) => col.every((cell) => cell === null))).toBe(true);
    expect(s1.board[2]).toEqual([PLAYER_ONE, null, null, null, null, null]);
    expect(s2.board[2]).toEqual([PLAYER_ONE, PLAYER_TWO, null, null, null, null]);
  });
});
