import { describe, expect, it } from "vitest";
import {
  MINESWEEPER_V1,
  adjacentMines,
  createBoard,
  flagsRemaining,
  isMine,
  isOver,
  neighbors,
  reveal,
  toggleFlag,
  type MinesweeperBoard,
  type MinesweeperConfig,
} from "./minesweeper";

const SMALL: MinesweeperConfig = { cols: 4, rows: 4, mines: 2 };

/** A board mid-game with a hand-placed layout, so flood-fill tests use known geometry. */
function withMines(config: MinesweeperConfig, mineIndices: number[]): MinesweeperBoard {
  const mines = new Array<boolean>(config.cols * config.rows).fill(false);
  for (const i of mineIndices) mines[i] = true;
  return { ...createBoard(1, config), mines, status: "playing" };
}

function revealedIndices(board: MinesweeperBoard): number[] {
  return board.revealed.flatMap((r, i) => (r ? [i] : []));
}

function mineIndices(board: MinesweeperBoard): number[] {
  return (board.mines ?? []).flatMap((m, i) => (m ? [i] : []));
}

describe("createBoard", () => {
  it("starts ready, untouched, with no layout yet", () => {
    const board = createBoard(42);
    expect(board.status).toBe("ready");
    expect(board.mines).toBeNull();
    expect(board.config).toEqual(MINESWEEPER_V1);
    expect(board.revealed).toHaveLength(48);
    expect(board.revealed.some(Boolean)).toBe(false);
    expect(board.flagged.some(Boolean)).toBe(false);
    expect(flagsRemaining(board)).toBe(7);
  });

  it("rejects configs that cannot be played", () => {
    expect(() => createBoard(1, { cols: 0, rows: 4, mines: 1 })).toThrow(RangeError);
    expect(() => createBoard(1, { cols: 3, rows: 3, mines: 0 })).toThrow(RangeError);
    expect(() => createBoard(1, { cols: 3, rows: 3, mines: 9 })).toThrow(RangeError);
    expect(() => createBoard(1, { cols: 2.5, rows: 3, mines: 1 })).toThrow(RangeError);
  });
});

describe("neighbors", () => {
  it("clips at corners, edges and the interior", () => {
    expect(neighbors(SMALL, 0)).toHaveLength(3);
    expect(neighbors(SMALL, 1)).toHaveLength(5);
    expect(neighbors(SMALL, 5)).toHaveLength(8);
    expect(neighbors(SMALL, 15)).toHaveLength(3);
  });

  it("does not wrap across rows", () => {
    // index 3 is the last column of row 0; index 4 is the first column of row 1.
    expect(neighbors(SMALL, 3)).not.toContain(4);
  });
});

describe("first reveal", () => {
  it("is never a mine, across many seeds and every starting cell", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      for (let cell = 0; cell < 48; cell += 1) {
        const board = reveal(createBoard(seed), cell);
        expect(board.status).not.toBe("lost");
        expect(isMine(board, cell)).toBe(false);
      }
    }
  });

  it("keeps the whole neighbourhood clear, so it opens an area", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const board = reveal(createBoard(seed), 20);
      for (const n of neighbors(board.config, 20)) expect(isMine(board, n)).toBe(false);
      expect(adjacentMines(board, 20)).toBe(0);
      expect(revealedIndices(board).length).toBeGreaterThan(1);
    }
  });

  it("places exactly the configured number of mines", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const board = reveal(createBoard(seed), 0);
      expect(mineIndices(board)).toHaveLength(7);
    }
  });

  it("falls back to protecting only the first cell on a crowded board", () => {
    // 3x3 with 8 mines: the neighbourhood can't all be spared, but the cell still can.
    const crowded: MinesweeperConfig = { cols: 3, rows: 3, mines: 8 };
    for (let cell = 0; cell < 9; cell += 1) {
      const board = reveal(createBoard(5, crowded), cell);
      expect(isMine(board, cell)).toBe(false);
      expect(mineIndices(board)).toHaveLength(8);
    }
  });
});

describe("determinism", () => {
  it("same seed + same reveal sequence gives an identical board", () => {
    const play = (): MinesweeperBoard => {
      let b = createBoard(1234);
      for (const cell of [20, 0, 47, 5, 33]) b = reveal(b, cell);
      return toggleFlag(b, 13);
    };
    expect(play()).toEqual(play());
  });

  it("different seeds give different layouts", () => {
    const layouts = new Set<string>();
    for (let seed = 0; seed < 20; seed += 1) {
      layouts.add(mineIndices(reveal(createBoard(seed), 20)).join(","));
    }
    expect(layouts.size).toBeGreaterThan(10);
  });

  it("does not mutate the board it was given", () => {
    const before = createBoard(9);
    const snapshot = JSON.stringify(before);
    reveal(before, 10);
    toggleFlag(before, 3);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("reveal + flood fill", () => {
  it("reveals a single numbered cell without expanding", () => {
    // Mine at 0; cell 1 touches it, so it shows a number and stops.
    const board = reveal(withMines(SMALL, [0, 15]), 1);
    expect(revealedIndices(board)).toEqual([1]);
    expect(adjacentMines(board, 1)).toBe(1);
    expect(board.status).toBe("playing");
  });

  it("floods through zeros and reveals the numbers that border them", () => {
    // Mines in the bottom-right corner; revealing the top-left floods through the zeros
    // and reveals the numbers bordering them, leaving only the mines hidden.
    const board = reveal(withMines(SMALL, [15, 14]), 0);
    expect(revealedIndices(board)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(board.status).toBe("won");
  });

  it("stops the flood at a flagged cell and never auto-reveals it", () => {
    const flagged = toggleFlag(withMines(SMALL, [15, 14]), 1);
    const board = reveal(flagged, 0);
    expect(board.revealed[1]).toBe(false);
    expect(board.flagged[1]).toBe(true);
    // Not won: the flagged safe cell is still hidden.
    expect(board.status).toBe("playing");
  });

  it("is a no-op on an already revealed cell", () => {
    const once = reveal(withMines(SMALL, [0, 15]), 1);
    expect(reveal(once, 1)).toBe(once);
  });

  it("does not reveal a flagged cell", () => {
    const flagged = toggleFlag(withMines(SMALL, [0, 15]), 5);
    expect(reveal(flagged, 5)).toBe(flagged);
  });
});

describe("win and loss", () => {
  it("loses on a mine, records which one, and reveals that cell", () => {
    const board = reveal(withMines(SMALL, [0, 15]), 0);
    expect(board.status).toBe("lost");
    expect(board.exploded).toBe(0);
    expect(board.revealed[0]).toBe(true);
    expect(isOver(board)).toBe(true);
  });

  it("wins once every safe cell is revealed, with no explosion recorded", () => {
    let board = withMines(SMALL, [0, 15]);
    for (let cell = 1; cell < 15; cell += 1) board = reveal(board, cell);
    expect(board.status).toBe("won");
    expect(board.revealed.filter(Boolean)).toHaveLength(14);
    expect(board.exploded).toBeNull();
  });

  it("does not win while safe cells remain hidden", () => {
    const board = reveal(withMines(SMALL, [0, 15]), 1);
    expect(board.status).toBe("playing");
  });

  it("ignores every move once the board is over", () => {
    const lost = reveal(withMines(SMALL, [0, 15]), 0);
    expect(reveal(lost, 5)).toBe(lost);
    expect(toggleFlag(lost, 5)).toBe(lost);
  });
});

describe("flags", () => {
  it("toggles on and off and counts against the mine total", () => {
    let board = createBoard(3);
    board = toggleFlag(board, 4);
    expect(board.flagged[4]).toBe(true);
    expect(flagsRemaining(board)).toBe(6);
    board = toggleFlag(board, 4);
    expect(board.flagged[4]).toBe(false);
    expect(flagsRemaining(board)).toBe(7);
  });

  it("can go negative when over-flagged", () => {
    let board = createBoard(3);
    for (let i = 0; i < 9; i += 1) board = toggleFlag(board, i);
    expect(flagsRemaining(board)).toBe(-2);
  });

  it("cannot flag a revealed cell", () => {
    const board = reveal(withMines(SMALL, [0, 15]), 1);
    expect(toggleFlag(board, 1)).toBe(board);
  });

  it("does not start the game, so a flag before the first reveal keeps it ready", () => {
    const board = toggleFlag(createBoard(3), 10);
    expect(board.status).toBe("ready");
    expect(board.mines).toBeNull();
  });

  it("a flagged cell can still be a safe first reveal target once unflagged", () => {
    let board = toggleFlag(createBoard(3), 10);
    expect(reveal(board, 10)).toBe(board);
    board = toggleFlag(board, 10);
    expect(reveal(board, 10).status).not.toBe("lost");
  });
});

describe("tampered input degrades to a no-op", () => {
  it.each([-1, 48, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "ignores out-of-range index %s",
    (index) => {
      const board = createBoard(7);
      expect(reveal(board, index)).toBe(board);
      expect(toggleFlag(board, index)).toBe(board);
    },
  );
});

describe("adjacentMines", () => {
  it("is 0 before any layout exists", () => {
    expect(adjacentMines(createBoard(1), 5)).toBe(0);
  });

  it("counts surrounding mines", () => {
    const board = withMines(SMALL, [0, 2, 8]);
    expect(adjacentMines(board, 5)).toBe(3); // touches 0, 2 and 8
    expect(adjacentMines(board, 9)).toBe(1); // touches 8
  });
});
