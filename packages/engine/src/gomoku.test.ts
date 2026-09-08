// Rules tests for the Gomoku GameModule (MPG-069/MPG-107). Conventions follow
// connect4.test.ts / nim.test.ts: pure engine only (no AI, no timing), every board
// built from a literal or a documented formula so a failure points at a real rule.

import { describe, it, expect } from "vitest";
import type { Cell, GomokuMove, GomokuState } from "./gomoku";
import { gomoku } from "./gomoku";
import { IllegalMoveError } from "./errors";

const SIZE = 9;
const PLAYER_ONE = 1;
const PLAYER_TWO = 2;

/** An empty 9x9 board. */
function emptyBoard(): Cell[][] {
  return Array.from({ length: SIZE }, () => new Array<Cell>(SIZE).fill(null));
}

/**
 * Builds a state from a compact string map: one row per line, `.` empty, `1`/`2` a
 * stone. Shorter/absent rows are padded empty, so a test only writes the cells it
 * cares about.
 */
function fromMap(map: string): GomokuState {
  const board = emptyBoard();
  const lines = map
    .trim()
    .split("\n")
    .map((line) => line.trim());
  lines.forEach((line, row) => {
    [...line].forEach((char, col) => {
      if (row >= SIZE || col >= SIZE) return;
      const boardRow = board[row];
      if (boardRow === undefined) return;
      boardRow[col] = char === "1" ? PLAYER_ONE : char === "2" ? PLAYER_TWO : null;
    });
  });
  return { board };
}

/** Places `stones` in order, alternating starting with player 1, via the real applyMove. */
function play(moves: readonly GomokuMove[]): GomokuState {
  let state = gomoku.createInitialState();
  moves.forEach((move, index) => {
    state = gomoku.applyMove(state, move, index % 2 === 0 ? PLAYER_ONE : PLAYER_TWO);
  });
  return state;
}

describe("gomoku: createInitialState", () => {
  it("starts as an empty 9x9 board with player 1 to move", () => {
    const state = gomoku.createInitialState();
    expect(state.board).toHaveLength(SIZE);
    for (const row of state.board) {
      expect(row).toHaveLength(SIZE);
      expect(row.every((cell) => cell === null)).toBe(true);
    }
    expect(gomoku.currentPlayer(state)).toBe(PLAYER_ONE);
    expect(gomoku.getResult(state)).toEqual({ status: "in_progress" });
  });

  it("declares two players", () => {
    expect(gomoku.playerCount).toBe(2);
    expect(gomoku.id).toBe("gomoku");
  });
});

describe("gomoku: currentPlayer", () => {
  it("alternates with each stone placed", () => {
    let state = gomoku.createInitialState();
    expect(gomoku.currentPlayer(state)).toBe(PLAYER_ONE);
    state = gomoku.applyMove(state, { row: 0, col: 0 }, PLAYER_ONE);
    expect(gomoku.currentPlayer(state)).toBe(PLAYER_TWO);
    state = gomoku.applyMove(state, { row: 1, col: 1 }, PLAYER_TWO);
    expect(gomoku.currentPlayer(state)).toBe(PLAYER_ONE);
  });
});

describe("gomoku: legalMoves", () => {
  it("offers every cell on an empty board", () => {
    expect(gomoku.legalMoves(gomoku.createInitialState())).toHaveLength(SIZE * SIZE);
  });

  it("excludes occupied cells", () => {
    const state = play([
      { row: 4, col: 4 },
      { row: 0, col: 0 },
    ]);
    const moves = gomoku.legalMoves(state);
    expect(moves).toHaveLength(SIZE * SIZE - 2);
    expect(moves).not.toContainEqual({ row: 4, col: 4 });
    expect(moves).not.toContainEqual({ row: 0, col: 0 });
  });

  it("returns no moves once the game is won", () => {
    const state = fromMap(`
      11111
    `);
    expect(gomoku.getResult(state).status).toBe("win");
    expect(gomoku.legalMoves(state)).toEqual([]);
  });
});

describe("gomoku: win detection", () => {
  it("detects a horizontal five", () => {
    const state = fromMap(`
      .........
      ..11111..
    `);
    expect(gomoku.getResult(state)).toEqual({
      status: "win",
      winner: PLAYER_ONE,
      line: [
        { row: 1, col: 2 },
        { row: 1, col: 3 },
        { row: 1, col: 4 },
        { row: 1, col: 5 },
        { row: 1, col: 6 },
      ],
    });
  });

  it("detects a vertical five", () => {
    const state = fromMap(`
      ..2......
      ..2......
      ..2......
      ..2......
      ..2......
    `);
    const result = gomoku.getResult(state);
    expect(result.status).toBe("win");
    if (result.status !== "win") return;
    expect(result.winner).toBe(PLAYER_TWO);
    expect(result.line).toEqual([
      { row: 0, col: 2 },
      { row: 1, col: 2 },
      { row: 2, col: 2 },
      { row: 3, col: 2 },
      { row: 4, col: 2 },
    ]);
  });

  it("detects a down-right diagonal five", () => {
    const state = fromMap(`
      1........
      .1.......
      ..1......
      ...1.....
      ....1....
    `);
    const result = gomoku.getResult(state);
    expect(result.status).toBe("win");
    if (result.status !== "win") return;
    expect(result.winner).toBe(PLAYER_ONE);
    expect(result.line).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 2 },
      { row: 3, col: 3 },
      { row: 4, col: 4 },
    ]);
  });

  it("detects a down-left (anti-)diagonal five", () => {
    const state = fromMap(`
      ....2....
      ...2.....
      ..2......
      .2.......
      2........
    `);
    const result = gomoku.getResult(state);
    expect(result.status).toBe("win");
    if (result.status !== "win") return;
    expect(result.winner).toBe(PLAYER_TWO);
    expect(result.line).toEqual([
      { row: 0, col: 4 },
      { row: 1, col: 3 },
      { row: 2, col: 2 },
      { row: 3, col: 1 },
      { row: 4, col: 0 },
    ]);
  });

  it("finds a line that starts mid-board, not only at an edge", () => {
    const state = fromMap(`
      .........
      .........
      .........
      .........
      ....11111
    `);
    const result = gomoku.getResult(state);
    expect(result.status).toBe("win");
    if (result.status !== "win") return;
    expect(result.line[0]).toEqual({ row: 4, col: 4 });
  });

  it("treats an overline (six in a row) as a win — freestyle has no upper cap", () => {
    const state = fromMap(`
      111111...
    `);
    const result = gomoku.getResult(state);
    expect(result.status).toBe("win");
    if (result.status !== "win") return;
    expect(result.winner).toBe(PLAYER_ONE);
    expect(result.line).toHaveLength(5);
  });

  it("does not call four in a row a win", () => {
    const state = fromMap(`
      1111.....
    `);
    expect(gomoku.getResult(state)).toEqual({ status: "in_progress" });
  });

  it("does not join two players' stones into a line", () => {
    const state = fromMap(`
      11122....
    `);
    expect(gomoku.getResult(state)).toEqual({ status: "in_progress" });
  });

  it("does not treat a broken run as a win", () => {
    const state = fromMap(`
      111.11...
    `);
    expect(gomoku.getResult(state)).toEqual({ status: "in_progress" });
  });

  it("does not wrap a run around the row edge", () => {
    // Three at the end of row 0 and two at the start of row 1 must not combine.
    const state = fromMap(`
      ......111
      11.......
    `);
    expect(gomoku.getResult(state)).toEqual({ status: "in_progress" });
  });
});

describe("gomoku: draw", () => {
  it("is a board-full draw when every cell is taken with no five", () => {
    // `(floor(row/2) + col) % 2` fills all 81 cells (41 for player 1, 40 for player 2 —
    // the legal split for an odd cell count) with no run of five in any direction.
    const board: Cell[][] = Array.from({ length: SIZE }, (_, row) =>
      Array.from({ length: SIZE }, (_, col) =>
        (Math.floor(row / 2) + col) % 2 === 0 ? PLAYER_ONE : PLAYER_TWO,
      ),
    );
    const state: GomokuState = { board };

    const ones = board.flat().filter((cell) => cell === PLAYER_ONE).length;
    expect(ones).toBe(41);
    expect(board.flat().filter((cell) => cell === PLAYER_TWO)).toHaveLength(40);
    expect(gomoku.getResult(state)).toEqual({ status: "draw", reason: "board-full" });
    expect(gomoku.legalMoves(state)).toEqual([]);
  });
});

describe("gomoku: applyMove", () => {
  it("places a stone for the mover and leaves the rest untouched", () => {
    const state = gomoku.applyMove(gomoku.createInitialState(), { row: 3, col: 5 }, PLAYER_ONE);
    expect(state.board[3]?.[5]).toBe(PLAYER_ONE);
    expect(state.board.flat().filter((cell) => cell !== null)).toHaveLength(1);
  });

  it("does not mutate the state it was given", () => {
    const before = gomoku.createInitialState();
    const snapshot = JSON.stringify(before);
    gomoku.applyMove(before, { row: 0, col: 0 }, PLAYER_ONE);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("rejects a move once the game is over", () => {
    const state = fromMap(`
      11111....
      .........
    `);
    expect(() => gomoku.applyMove(state, { row: 5, col: 5 }, PLAYER_TWO)).toThrow(IllegalMoveError);
    try {
      gomoku.applyMove(state, { row: 5, col: 5 }, PLAYER_TWO);
    } catch (error) {
      expect((error as IllegalMoveError).reason).toBe("game_over");
    }
  });

  it("rejects a move by the player who is not to move", () => {
    const state = gomoku.createInitialState();
    try {
      gomoku.applyMove(state, { row: 0, col: 0 }, PLAYER_TWO);
      expect.unreachable("expected a not_your_turn error");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalMoveError);
      expect((error as IllegalMoveError).reason).toBe("not_your_turn");
    }
  });

  it.each([
    { row: -1, col: 0 },
    { row: 0, col: -1 },
    { row: SIZE, col: 0 },
    { row: 0, col: SIZE },
    { row: 1.5, col: 0 },
  ])("rejects the out-of-bounds cell %j", (move) => {
    const state = gomoku.createInitialState();
    try {
      gomoku.applyMove(state, move, PLAYER_ONE);
      expect.unreachable("expected an out_of_bounds error");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalMoveError);
      expect((error as IllegalMoveError).reason).toBe("out_of_bounds");
    }
  });

  it("rejects a cell that is already occupied", () => {
    const state = gomoku.applyMove(gomoku.createInitialState(), { row: 2, col: 2 }, PLAYER_ONE);
    try {
      gomoku.applyMove(state, { row: 2, col: 2 }, PLAYER_TWO);
      expect.unreachable("expected an illegal_move error");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalMoveError);
      expect((error as IllegalMoveError).reason).toBe("illegal_move");
    }
  });
});

describe("gomoku: evaluate", () => {
  it("is symmetric in sign — a position good for one side is bad for the other", () => {
    const state = fromMap(`
      .111.....
    `);
    expect(gomoku.evaluate(state, PLAYER_ONE)).toBeGreaterThan(0);
    expect(gomoku.evaluate(state, PLAYER_TWO)).toBeLessThan(0);
  });

  it("scores an open three above a blocked three", () => {
    const open = fromMap(`
      .111.....
    `);
    const blocked = fromMap(`
      2111.....
    `);
    expect(gomoku.evaluate(open, PLAYER_ONE)).toBeGreaterThan(gomoku.evaluate(blocked, PLAYER_ONE));
  });

  it("scores a longer run above a shorter one", () => {
    const three = fromMap(`
      .111.....
    `);
    const four = fromMap(`
      .1111....
    `);
    expect(gomoku.evaluate(four, PLAYER_ONE)).toBeGreaterThan(gomoku.evaluate(three, PLAYER_ONE));
  });

  it("rates an empty board as level", () => {
    expect(gomoku.evaluate(gomoku.createInitialState(), PLAYER_ONE)).toBe(0);
  });
});

describe("gomoku: orderMoves", () => {
  it("plays only the center on an empty board (every opening is symmetric)", () => {
    const state = gomoku.createInitialState();
    const ordered = gomoku.orderMoves?.(state, gomoku.legalMoves(state));
    expect(ordered).toEqual([{ row: 4, col: 4 }]);
  });

  it("restricts candidates to cells near existing stones, capped at 12", () => {
    const state = play([
      { row: 4, col: 4 },
      { row: 4, col: 5 },
    ]);
    const ordered = gomoku.orderMoves?.(state, gomoku.legalMoves(state)) ?? [];

    expect(ordered.length).toBeGreaterThan(0);
    expect(ordered.length).toBeLessThanOrEqual(12);
    // Every candidate is within the documented radius of 2 of some stone, so a far
    // corner is never considered.
    for (const move of ordered) {
      const nearStone =
        Math.max(Math.abs(move.row - 4), Math.abs(move.col - 4)) <= 2 ||
        Math.max(Math.abs(move.row - 4), Math.abs(move.col - 5)) <= 2;
      expect(nearStone).toBe(true);
    }
    expect(ordered).not.toContainEqual({ row: 0, col: 0 });
  });

  it("only ever returns legal moves", () => {
    const state = play([
      { row: 4, col: 4 },
      { row: 3, col: 3 },
      { row: 5, col: 5 },
    ]);
    const legal = new Set(gomoku.legalMoves(state).map((m) => `${m.row},${m.col}`));
    const ordered = gomoku.orderMoves?.(state, gomoku.legalMoves(state)) ?? [];
    for (const move of ordered) {
      expect(legal.has(`${move.row},${move.col}`)).toBe(true);
    }
  });
});
