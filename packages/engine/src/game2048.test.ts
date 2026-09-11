import { describe, it, expect } from "vitest";
import {
  GAME_2048,
  applySwipe,
  createGame2048,
  game2048,
  game2048IdForSize,
  game2048Size,
  game2048_3,
  game2048_5,
  highestTile,
  type Game2048Input,
  type Game2048State,
  type SwipeDir,
} from "./game2048";
import { clearRealtimeRegistry, getRealtimeGame } from "./realtime-registry";
import { registerBuiltInRealtimeGames } from "./realtime-games";

const NONE: Game2048Input = { swipe: null };
const swipe = (dir: SwipeDir): Game2048Input => ({ swipe: dir });

/** Non-zero tile count — a proxy for "how many tiles are on the board". */
function tileCount(state: Game2048State): number {
  return state.board.filter((v) => v !== 0).length;
}

/** Builds a state around a hand-authored board (rest defaults to a fresh run). */
function withBoard(board: number[], score = 0): Game2048State {
  const base = game2048.createInitialState(1);
  return { ...base, board, score, over: false };
}

describe("2048 module", () => {
  it("starts with exactly two tiles and a zero score", () => {
    const state = game2048.createInitialState(42);
    expect(state.board).toHaveLength(GAME_2048.size * GAME_2048.size);
    expect(tileCount(state)).toBe(2);
    expect(state.score).toBe(0);
    expect(state.over).toBe(false);
    expect(game2048.getScore(state)).toBe(0);
  });

  it("slides and merges a line toward the front, scoring the merged sum", () => {
    // [2, 2, 4, 0] swiped left -> [4, 4, 0, 0], scoring 4 for the merge.
    const { board, gained, moved } = applySwipe(
      [2, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "left",
    );
    expect(board.slice(0, 4)).toEqual([4, 4, 0, 0]);
    expect(gained).toBe(4);
    expect(moved).toBe(true);
  });

  it("merges each pair only once per move", () => {
    // [2, 2, 2, 2] left -> [4, 4, 0, 0], not [8, 0, 0, 0].
    const { board, gained } = applySwipe([2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "left");
    expect(board.slice(0, 4)).toEqual([4, 4, 0, 0]);
    expect(gained).toBe(8);
  });

  it("slides toward the swiped edge for every direction", () => {
    const one = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2];
    expect(applySwipe(one, "up").board[0 * 4 + 3]).toBe(2); // bottom-right -> top-right
    expect(applySwipe(one, "left").board[3 * 4 + 0]).toBe(2); // -> bottom-left
    expect(applySwipe(one, "right").board).toEqual(one); // already at bottom-right
    expect(applySwipe(one, "down").board).toEqual(one);
  });

  it("spawns exactly one new tile on a move that changes the board", () => {
    const before = withBoard([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const after = game2048.tick(before, swipe("left"));
    // Two tiles merged into one (count -1), then a spawn (+1): net one tile.
    expect(tileCount(after)).toBe(2);
    expect(after.score).toBe(4);
  });

  it("does not move, spawn, or score when a swipe changes nothing", () => {
    const before = withBoard([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const after = game2048.tick(before, swipe("left")); // already packed left
    expect(after).toBe(before); // same reference — a true no-op
  });

  it("treats a null swipe as a no-op tick", () => {
    const before = game2048.createInitialState(7);
    expect(game2048.tick(before, NONE)).toBe(before);
  });

  it("recognizes a full, unmergeable board as having no legal move", () => {
    // No two orthogonal neighbours are equal and every cell is filled — the exact
    // condition the module treats as game over. Every swipe must be a no-op.
    const locked = [
      2,
      4,
      2,
      4, //
      8,
      16,
      8,
      16, //
      2,
      4,
      2,
      4, //
      8,
      16,
      8,
      16, //
    ];
    const state = withBoard(locked);
    for (const dir of ["up", "down", "left", "right"] as const) {
      expect(applySwipe(locked, dir).moved).toBe(false);
      expect(game2048.tick(state, swipe(dir))).toBe(state);
    }
  });

  it("eventually ends a run of greedy fixed-cycle swipes (over flips via a real move)", () => {
    // A 4x4 board locks with overwhelming probability under a repeated
    // up/left/down/right cycle; a fixed seed makes it deterministic. This drives
    // the actual game-over path (merge -> spawn -> no move remains).
    const cycle: SwipeDir[] = ["up", "left", "down", "right"];
    let state = game2048.createInitialState(98765);
    let ended = false;
    for (let i = 0; i < 5000 && !ended; i += 1) {
      state = game2048.tick(state, swipe(cycle[i % cycle.length] ?? "up"));
      ended = state.over;
    }
    expect(ended).toBe(true);
    expect(game2048.isGameOver(state)).toBe(true);
    expect(game2048.getScore(state)).toBeGreaterThan(0);
  });

  it("freezes once over — further ticks are no-ops", () => {
    const over: Game2048State = { ...withBoard([2, 0, 0, 0]), over: true };
    expect(game2048.tick(over, swipe("up"))).toBe(over);
  });

  it("is deterministic: same seed + inputs reproduce the run exactly", () => {
    const inputs = [swipe("left"), swipe("up"), swipe("right"), swipe("down"), swipe("left")];
    const run = (): Game2048State => {
      let s = game2048.createInitialState(12345);
      for (const i of inputs) s = game2048.tick(s, i);
      return s;
    };
    expect(run()).toEqual(run());
  });

  it("reports the highest tile", () => {
    expect(highestTile(withBoard([2, 4, 8, 0, 0, 16, 0, 0]))).toBe(16);
  });
});

describe("2048 selectable grid size (MPG-096)", () => {
  it("maps each size to a distinct id, 4 being the canonical `2048`", () => {
    expect(game2048IdForSize(3)).toBe("2048@3");
    expect(game2048IdForSize(4)).toBe("2048");
    expect(game2048IdForSize(5)).toBe("2048@5");
    expect(game2048.id).toBe("2048");
    expect(game2048_3.id).toBe("2048@3");
    expect(game2048_5.id).toBe("2048@5");
  });

  it.each([3, 4, 5] as const)("builds a %i×%i board carrying its own size", (size) => {
    const module = createGame2048(size);
    const state = module.createInitialState(42);
    expect(state.board).toHaveLength(size * size);
    expect(game2048Size(state)).toBe(size);
    expect(tileCount(state)).toBe(2); // two starting tiles at every size
  });

  it("slides and merges a 3×3 line the same way, at the smaller width", () => {
    // 3×3, top row [2,2,4] swiped left -> [4,4,0], scoring 4.
    const board = [2, 2, 4, 0, 0, 0, 0, 0, 0];
    const { board: after, gained, moved } = applySwipe(board, "left", 3);
    expect(after.slice(0, 3)).toEqual([4, 4, 0]);
    expect(gained).toBe(4);
    expect(moved).toBe(true);
  });

  it("ends a 3×3 run of greedy swipes (the smaller board locks quickly)", () => {
    const cycle: SwipeDir[] = ["up", "left", "down", "right"];
    let state = game2048_3.createInitialState(2024);
    let ended = false;
    for (let i = 0; i < 5000 && !ended; i += 1) {
      state = game2048_3.tick(state, { swipe: cycle[i % cycle.length] ?? "up" });
      ended = state.over;
    }
    expect(ended).toBe(true);
    expect(game2048_3.getScore(state)).toBeGreaterThan(0);
  });
});

describe("2048 registry wiring", () => {
  it("registers the default board and both size variants", () => {
    clearRealtimeRegistry();
    registerBuiltInRealtimeGames();
    for (const [id, size] of [
      ["2048", 4],
      ["2048@3", 3],
      ["2048@5", 5],
    ] as const) {
      const module = getRealtimeGame(id);
      expect(module.id).toBe(id);
      expect(module.kind).toBe("realtime");
      // The registered module builds a board of the right dimension for re-sim.
      expect(module.createInitialState(1).board).toHaveLength(size * size);
    }
  });
});
