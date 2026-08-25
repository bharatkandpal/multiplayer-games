import { describe, it, expect } from "vitest";
import type { GameModule, Player } from "../types";
import type { TicTacToeState, TicTacToeMove } from "../tictactoe";
import { ticTacToe } from "../tictactoe";
import type { ConnectFourState, ConnectFourMove } from "../connect4";
import { connectFour } from "../connect4";
import { minimax, searchBestMove } from "./minimax";

const PLAYER_X = 1;
const PLAYER_O = 2;

/** Plays cell indices through `ticTacToe.applyMove`, alternating X then O. */
function playTTT(cells: readonly number[]): TicTacToeState {
  let state = ticTacToe.createInitialState();
  cells.forEach((cell, i) => {
    const player = i % 2 === 0 ? PLAYER_X : PLAYER_O;
    state = ticTacToe.applyMove(state, { cell }, player);
  });
  return state;
}

/** Drops discs into columns through `connectFour.applyMove`, alternating player 1 then 2. */
function playC4(columns: readonly number[]): ConnectFourState {
  let state = connectFour.createInitialState();
  columns.forEach((column, i) => {
    const player = i % 2 === 0 ? PLAYER_ONE_C4 : PLAYER_TWO_C4;
    state = connectFour.applyMove(state, { column }, player);
  });
  return state;
}

const PLAYER_ONE_C4 = 1;
const PLAYER_TWO_C4 = 2;

/**
 * Naive minimax oracle with NO alpha-beta pruning: searches every move at every node.
 * Mirrors the scoring conventions in `minimax.ts` (faster wins, slower losses, 0 draw,
 * heuristic at depth cutoff) so its values are directly comparable to `minimax`'s.
 * Used only as a reference in tests — never as production code.
 */
function naiveMinimax<S, M>(
  game: GameModule<S, M>,
  state: S,
  depth: number,
  rootPlayer: Player,
  depthFromRoot = 0,
): number {
  const result = game.getResult(state);
  if (result.status === "win") {
    return result.winner === rootPlayer ? 1_000_000 - depthFromRoot : -1_000_000 + depthFromRoot;
  }
  if (result.status === "draw") {
    return 0;
  }
  if (depth === 0) {
    return game.evaluate(state, rootPlayer);
  }

  const moves = game.legalMoves(state);
  const mover = game.currentPlayer(state);
  const maximizing = mover === rootPlayer;

  let best = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    const next = game.applyMove(state, move, mover);
    const score = naiveMinimax(game, next, depth - 1, rootPlayer, depthFromRoot + 1);
    best = maximizing ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

describe("minimax: immediate win", () => {
  it("picks the winning move when one is available (TTT)", () => {
    // X: 0, 1 (top row, two in a row); O: 3, 4. X to move, cell 2 wins immediately.
    const state = playTTT([0, 3, 1, 4]);
    expect(ticTacToe.currentPlayer(state)).toBe(PLAYER_X);
    const { move, score } = searchBestMove(ticTacToe, state, { maxDepth: 9 });
    expect(move).toEqual({ cell: 2 });
    expect(score).toBeGreaterThan(900_000);
  });
});

describe("minimax: blocks an immediate loss", () => {
  it("blocks the opponent's winning threat instead of ignoring it (TTT)", () => {
    // X: 0, 1, 8 (threatens to win row 0 at cell 2); O: 4, 7 (no threat of their own).
    // It's O's move: O must block at 2, otherwise X wins next turn.
    const state = playTTT([0, 4, 1, 7, 8]);
    expect(ticTacToe.currentPlayer(state)).toBe(PLAYER_O);
    const { move } = searchBestMove(ticTacToe, state, { maxDepth: 9 });
    expect(move).toEqual({ cell: 2 });
  });
});

describe("minimax: never picks a losing move (full-depth TTT)", () => {
  it.each([
    { name: "opening position", cells: [] },
    { name: "after center opening", cells: [4] },
    { name: "after corner opening", cells: [0] },
    { name: "mid-game, X has initiative", cells: [0, 4, 8] },
  ])("$name: the chosen move's score is never a forced loss", ({ cells }) => {
    const state = playTTT(cells);
    const { score } = searchBestMove(ticTacToe, state, { maxDepth: 9 });
    // A perfectly played TTT position from either side is at worst a draw (score 0),
    // never a forced loss (negative score).
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe("minimax: prefers faster wins over slower ones", () => {
  it("chooses the immediate winning move over a slower alternative (TTT)", () => {
    // X: 0, 1 (wins immediately at 2, completing row 0); O: 4, 7. X to move.
    const state = playTTT([0, 4, 1, 7]);
    expect(ticTacToe.currentPlayer(state)).toBe(PLAYER_X);
    const { move, score } = searchBestMove(ticTacToe, state, { maxDepth: 9 });
    expect(move).toEqual({ cell: 2 });
    // Winning at depthFromRoot=1 scores WIN_SCORE - 1 (fastest possible win).
    expect(score).toBe(1_000_000 - 1);

    // Any other legal move forgoes the immediate win, so its (fully-searched) value
    // from the same position is strictly worse than the immediate win's score.
    const alternative = ticTacToe.applyMove(state, { cell: 8 }, PLAYER_X);
    const alternativeScore = naiveMinimax(ticTacToe, alternative, 8, PLAYER_X, 1);
    expect(alternativeScore).toBeLessThan(score);
  });
});

describe("minimax: alpha-beta search value matches a naive (unpruned) oracle", () => {
  it.each([
    { name: "opening position", cells: [] as number[], depth: 9 },
    { name: "after center opening", cells: [4], depth: 9 },
    { name: "after corner opening", cells: [0], depth: 9 },
    { name: "one move from a forced win", cells: [0, 3, 1, 4], depth: 9 },
    { name: "must block", cells: [0, 4, 1, 5], depth: 9 },
    { name: "mid-game, shallower search", cells: [0, 4, 8], depth: 4 },
  ])("$name (depth $depth): identical score to the unpruned oracle", ({ cells, depth }) => {
    const state = playTTT(cells);
    const rootPlayer = ticTacToe.currentPlayer(state);

    const { score: prunedScore } = searchBestMove(ticTacToe, state, { maxDepth: depth });
    const oracleScore = naiveMinimax(ticTacToe, state, depth, rootPlayer);

    expect(prunedScore).toBe(oracleScore);
  });
});

describe("minimax: move ordering is a pure speed optimization", () => {
  it("Connect Four search value is unchanged whether orderMoves is present or absent", () => {
    const state = playC4([3, 2, 3]); // a small, non-trivial mid-opening position
    const depth = 4;

    const withOrdering = searchBestMove(connectFour, state, { maxDepth: depth });

    // A wrapper game identical to `connectFour` except it omits `orderMoves`,
    // falling back to `legalMoves`' natural (left-to-right column) order.
    const unordered: GameModule<ConnectFourState, ConnectFourMove> = {
      id: connectFour.id,
      playerCount: connectFour.playerCount,
      createInitialState: connectFour.createInitialState,
      legalMoves: connectFour.legalMoves,
      applyMove: connectFour.applyMove,
      getResult: connectFour.getResult,
      currentPlayer: connectFour.currentPlayer,
      evaluate: connectFour.evaluate,
      // orderMoves intentionally omitted.
    };
    const withoutOrdering = searchBestMove(unordered, state, { maxDepth: depth });

    expect(withoutOrdering.score).toBe(withOrdering.score);
  });
});

describe("minimax: determinism", () => {
  it("returns the same move across repeated calls on the same state (TTT)", () => {
    const state = playTTT([4, 0]);
    const first = searchBestMove(ticTacToe, state, { maxDepth: 9 });
    const second = searchBestMove(ticTacToe, state, { maxDepth: 9 });
    const third = searchBestMove(ticTacToe, state, { maxDepth: 9 });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("returns the same move across repeated calls on the same state (Connect Four)", () => {
    const state = playC4([3, 2]);
    const first = searchBestMove(connectFour, state, { maxDepth: 4 });
    const second = searchBestMove(connectFour, state, { maxDepth: 4 });
    expect(second).toEqual(first);
  });
});

describe("minimax: guards", () => {
  it("throws when there are no legal moves (terminal state)", () => {
    const state = playTTT([0, 3, 1, 4, 2]); // X wins row 0; game is over
    expect(ticTacToe.legalMoves(state)).toEqual([]);
    expect(() => searchBestMove(ticTacToe, state, { maxDepth: 9 })).toThrow();
  });

  it("throws a clear error when there are no legal moves", () => {
    const state = playTTT([0, 3, 1, 4, 2]);
    expect(() => searchBestMove(ticTacToe, state, { maxDepth: 9 })).toThrow(/no legal moves/i);
  });

  it("throws for games with playerCount !== 2", () => {
    const threePlayerGame: GameModule<TicTacToeState, TicTacToeMove> = {
      ...ticTacToe,
      playerCount: 3,
    };
    const state = ticTacToe.createInitialState();
    expect(() => searchBestMove(threePlayerGame, state, { maxDepth: 9 })).toThrow(/2-player/i);
  });
});

describe("minimax: performance sanity (Connect Four, shallow search)", () => {
  it("returns a valid legal move from the opening within a generous time budget", () => {
    const state = connectFour.createInitialState();
    const legal = new Set(connectFour.legalMoves(state).map((m) => m.column));

    const start = Date.now();
    const { move } = searchBestMove(connectFour, state, { maxDepth: 6 });
    const elapsed = Date.now() - start;

    expect(legal.has(move.column)).toBe(true);
    // Very loose bound: this guards against gross performance regressions, not
    // tuned timing — see docs/GAME_LOGIC.md §4 (< 500ms move budget, tested properly
    // in MPG-008's AI runner suite).
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("minimax (low-level function): agrees with searchBestMove's chosen score", () => {
  it("minimax on the state after the best move matches searchBestMove's reported score", () => {
    const state = playTTT([0, 3, 1, 4]);
    const rootPlayer = ticTacToe.currentPlayer(state);
    const { move, score } = searchBestMove(ticTacToe, state, { maxDepth: 9 });

    const next = ticTacToe.applyMove(state, move, rootPlayer);
    const replayed = minimax(ticTacToe, next, 8, -Infinity, Infinity, rootPlayer, 1);

    expect(replayed).toBe(score);
  });
});
