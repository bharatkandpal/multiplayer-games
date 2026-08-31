import { describe, it, expect } from "vitest";
import type { NimState } from "./nim";
import { nim, DEFAULT_PILES } from "./nim";
import { IllegalMoveError } from "./errors";

const PLAYER_ONE = 1;
const PLAYER_TWO = 2;

function state(piles: readonly number[], toMove = PLAYER_ONE): NimState {
  return { piles, toMove };
}

describe("nim: createInitialState", () => {
  it("starts with the default piles and player 1 to move", () => {
    const s = nim.createInitialState();
    expect(s.piles).toEqual(DEFAULT_PILES);
    expect(nim.currentPlayer(s)).toBe(PLAYER_ONE);
    expect(nim.getResult(s)).toEqual({ status: "in_progress" });
  });
});

describe("nim: legalMoves", () => {
  it("returns every (pile, count) pair for a fresh multi-pile position", () => {
    const s = state([2, 0, 1]);
    const moves = nim.legalMoves(s);
    // pile 0 (size 2): count 1,2 ; pile 1 (size 0): none ; pile 2 (size 1): count 1.
    expect(moves).toEqual(
      expect.arrayContaining([
        { pile: 0, count: 1 },
        { pile: 0, count: 2 },
        { pile: 2, count: 1 },
      ]),
    );
    expect(moves).toHaveLength(3);
  });

  it("returns no moves once every pile is empty", () => {
    const s = state([0, 0, 0]);
    expect(nim.legalMoves(s)).toEqual([]);
  });

  it("returns no moves for a single empty pile", () => {
    expect(nim.legalMoves(state([0]))).toEqual([]);
  });

  it("offers exactly `size` moves for a lone nonempty pile", () => {
    const moves = nim.legalMoves(state([5]));
    expect(moves).toHaveLength(5);
    expect(moves.map((m) => m.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("nim: applyMove", () => {
  it("removes the taken count from the target pile and flips the turn", () => {
    const s = state([3, 4], PLAYER_ONE);
    const next = nim.applyMove(s, { pile: 1, count: 2 }, PLAYER_ONE);
    expect(next.piles).toEqual([3, 2]);
    expect(nim.currentPlayer(next)).toBe(PLAYER_TWO);
  });

  it("does not mutate the input state", () => {
    const s = state([3, 4], PLAYER_ONE);
    const before = s.piles.slice();
    nim.applyMove(s, { pile: 0, count: 1 }, PLAYER_ONE);
    expect(s.piles).toEqual(before);
  });

  it("can take an entire pile in one move", () => {
    const next = nim.applyMove(state([1, 3]), { pile: 0, count: 1 }, PLAYER_ONE);
    expect(next.piles).toEqual([0, 3]);
  });

  it("rejects a move out of turn with reason not_your_turn", () => {
    const s = state([3], PLAYER_ONE);
    expect(() => nim.applyMove(s, { pile: 0, count: 1 }, PLAYER_TWO)).toThrow(IllegalMoveError);
    try {
      nim.applyMove(s, { pile: 0, count: 1 }, PLAYER_TWO);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalMoveError);
      expect((err as IllegalMoveError).reason).toBe("not_your_turn");
    }
  });

  it.each([-1, 2, 100])("rejects an out-of-bounds pile index (%i)", (pile) => {
    const s = state([3, 4]);
    expect(() => nim.applyMove(s, { pile, count: 1 }, PLAYER_ONE)).toThrow(IllegalMoveError);
    try {
      nim.applyMove(s, { pile, count: 1 }, PLAYER_ONE);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("out_of_bounds");
    }
  });

  it("rejects taking more objects than a pile has, with reason illegal_move", () => {
    const s = state([3, 4]);
    expect(() => nim.applyMove(s, { pile: 0, count: 4 }, PLAYER_ONE)).toThrow(IllegalMoveError);
    try {
      nim.applyMove(s, { pile: 0, count: 4 }, PLAYER_ONE);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("illegal_move");
    }
  });

  it("rejects taking zero or a negative count, with reason illegal_move", () => {
    const s = state([3, 4]);
    for (const count of [0, -1]) {
      expect(() => nim.applyMove(s, { pile: 0, count }, PLAYER_ONE)).toThrow(IllegalMoveError);
      try {
        nim.applyMove(s, { pile: 0, count }, PLAYER_ONE);
        expect.unreachable();
      } catch (err) {
        expect((err as IllegalMoveError).reason).toBe("illegal_move");
      }
    }
  });

  it("rejects taking from an already-empty pile", () => {
    const s = state([0, 4]);
    expect(() => nim.applyMove(s, { pile: 0, count: 1 }, PLAYER_ONE)).toThrow(IllegalMoveError);
  });

  it("rejects any move once the game has ended, with reason game_over", () => {
    const s = state([0, 0], PLAYER_TWO);
    expect(() => nim.applyMove(s, { pile: 0, count: 1 }, PLAYER_TWO)).toThrow(IllegalMoveError);
    try {
      nim.applyMove(s, { pile: 0, count: 1 }, PLAYER_TWO);
      expect.unreachable();
    } catch (err) {
      expect((err as IllegalMoveError).reason).toBe("game_over");
    }
  });
});

describe("nim: win detection (normal play — last to take wins)", () => {
  it("declares the mover who empties the last pile the winner", () => {
    let s = state([1], PLAYER_ONE);
    expect(nim.getResult(s)).toEqual({ status: "in_progress" });
    s = nim.applyMove(s, { pile: 0, count: 1 }, PLAYER_ONE);
    expect(nim.getResult(s)).toEqual({ status: "win", winner: PLAYER_ONE, line: [0] });
  });

  it("declares player 2 the winner when they take the last objects", () => {
    let s = state([1, 1], PLAYER_ONE);
    s = nim.applyMove(s, { pile: 0, count: 1 }, PLAYER_ONE);
    expect(nim.getResult(s).status).toBe("in_progress");
    s = nim.applyMove(s, { pile: 1, count: 1 }, PLAYER_TWO);
    expect(nim.getResult(s)).toEqual({ status: "win", winner: PLAYER_TWO, line: [0, 1] });
  });

  it("has no draw outcome — Nim always ends in a win", () => {
    // Play out the default game fully via a deterministic (always-take-1-from-first-nonempty)
    // strategy and confirm it always terminates in a "win", never "draw".
    let s = nim.createInitialState();
    let result = nim.getResult(s);
    let guard = 0;
    while (result.status === "in_progress" && guard < 100) {
      const mover = nim.currentPlayer(s);
      const pile = s.piles.findIndex((n) => n > 0);
      s = nim.applyMove(s, { pile, count: 1 }, mover);
      result = nim.getResult(s);
      guard++;
    }
    expect(result.status).toBe("win");
  });

  it("never returns legal moves from a terminal state", () => {
    const s = state([0, 0, 0], PLAYER_ONE);
    expect(nim.legalMoves(s)).toEqual([]);
  });
});

describe("nim: currentPlayer alternation", () => {
  it("alternates strictly after every move regardless of how many objects are taken", () => {
    let s = nim.createInitialState();
    expect(nim.currentPlayer(s)).toBe(PLAYER_ONE);
    s = nim.applyMove(s, { pile: 3, count: 7 }, PLAYER_ONE);
    expect(nim.currentPlayer(s)).toBe(PLAYER_TWO);
    s = nim.applyMove(s, { pile: 2, count: 1 }, PLAYER_TWO);
    expect(nim.currentPlayer(s)).toBe(PLAYER_ONE);
  });
});
