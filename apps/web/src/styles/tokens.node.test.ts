import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/*
 * `.node.test.ts`, not `.test.ts`: this reads stylesheets off disk, so it needs node
 * types, which the browser project deliberately does not carry — tsconfig.api.json
 * picks it up instead (see the comments in both tsconfigs). Vite's `?raw` would be
 * the browser-native way to do this, but vitest stubs CSS imports to an empty string
 * by default and `css: { include: [...] }` does not restore `?raw` content.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const tokens = read("./tokens.css");
const connectFour = read("../components/board/ConnectFourBoard.module.css");
const nim = read("../components/board/NimBoard.module.css");
const boardGrid = read("../components/board/BoardGrid.module.css");

/** The three boards that are literal row/column grids, and so go through `BoardGrid`. */
const GRID_BOARDS = {
  TicTacToeBoard: read("../components/board/TicTacToeBoard.module.css"),
  TicTacToeMoveBoard: read("../components/board/TicTacToeMoveBoard.module.css"),
  GomokuBoard: read("../components/board/GomokuBoard.module.css"),
};

/**
 * Guards for the tier-2 game material tokens (UI-9 / MPG-116).
 *
 * jsdom has no layout and no cascade, so no rendering test can see whether a board
 * still looks like a physical object. What IS checkable is the contract the tokens
 * were introduced to create, and these are the two halves of it: boards consume the
 * shared material instead of re-deriving it, and the material does not vary by theme.
 */

/** The `:root` block — every `--game-*` token should be declared here and only here. */
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? "";

const GAME_TOKENS = [
  "--game-panel-sheen",
  "--game-panel-edge-light",
  "--game-surface-hover",
  "--game-well-shadow",
  "--game-piece-rim",
  "--game-piece-cast",
  "--game-piece-shadow",
  "--game-piece-gloss",
];

describe("tier-2 game material tokens", () => {
  it.each(GAME_TOKENS)("declares %s in :root", (name) => {
    expect(rootBlock).toContain(`${name}:`);
  });

  it("declares every --game-* token exactly once, so no theme block overrides one", () => {
    // A highlight film is the same film on a dark board — the ground underneath
    // changes with the theme, the film on top does not. A second declaration would
    // silently retune every board in one theme only.
    for (const name of GAME_TOKENS) {
      const declarations = tokens.match(new RegExp(`^\\s*${name}:`, "gm")) ?? [];
      expect(declarations, `${name} is declared ${declarations.length} times`).toHaveLength(1);
    }
  });
});

describe("ConnectFourBoard consumes the material layer", () => {
  it("has no raw colour literals left", () => {
    // MPG-116 promoted fifteen of these. The board's colours now come from tier-1
    // semantic tokens and its materials from tier-2 — a literal here is the drift
    // UI-9 exists to stop, and UI-10 will hand the same materials to every board.
    const literals = connectFour.match(/rgba?\(|#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(literals).toEqual([]);
  });

  it.each([
    ["--game-panel-sheen", "the raised panel's lit and shaded edges"],
    ["--game-panel-edge-light", "the panel's top catchlight"],
    ["--game-surface-hover", "the column hover wash"],
    ["--game-well-shadow", "the punched hole behind each disc"],
    ["--game-piece-rim", "the disc rim"],
    ["--game-piece-shadow", "the disc's cast shadow + catchlight"],
    ["--game-piece-gloss", "the disc's off-centre gloss"],
  ])("uses %s for %s", (name) => {
    expect(connectFour).toContain(`var(${name})`);
  });
});

/**
 * Guards for the board cell grammar (UI-10 / MPG-117).
 *
 * The drift these replace was not subtle and not caught by any test: two boards
 * shared a byte-identical `.cell` block by copy-paste, a third had quietly
 * diverged on border weight, press scale and win-pulse scale, and a fourth
 * re-derived the same raised surface from tier-1 tokens. jsdom cannot see any of
 * that, but the stylesheets can be read.
 */

const BOARD_TOKENS = [
  "--board-gap",
  "--board-cell-radius",
  "--board-cell-border",
  "--board-cell-padding",
  "--board-cell-min-size",
  "--board-gap-dense",
  "--board-cell-radius-dense",
  "--board-cell-border-dense",
  "--board-cell-padding-dense",
  "--board-cell-min-size-dense",
  "--board-cell-bg",
  "--board-cell-bg-hover",
  "--board-cell-shadow",
  "--board-cell-press-scale",
  "--board-ring-width",
  "--board-ring-width-thin",
  "--board-pulse-scale",
];

describe("board cell grammar tokens", () => {
  it.each(BOARD_TOKENS)("declares %s in :root", (name) => {
    expect(rootBlock).toContain(`${name}:`);
  });

  it("declares every --board-* token exactly once, so no theme block overrides one", () => {
    // These are dimensions, not colours — a cell is cut to the same size in
    // both themes. What they resolve to (--color-surface-raised, --shadow-sm)
    // is already theme-aware one tier down; re-declaring here would retune
    // every board in one theme only.
    for (const name of BOARD_TOKENS) {
      const declarations = tokens.match(new RegExp(`^\\s*${name}:`, "gm")) ?? [];
      expect(declarations, `${name} is declared ${declarations.length} times`).toHaveLength(1);
    }
  });

  it("keeps the dense density a named decision rather than a per-board accident", () => {
    // Gomoku's 9x9 genuinely cannot afford a 3x3's gap, padding or 44px floor.
    // That difference is legitimate; it drifting silently is not.
    for (const name of BOARD_TOKENS.filter((t) => t.endsWith("-dense"))) {
      expect(boardGrid).toContain(`var(${name})`);
    }
  });
});

describe("every board reads the shared grammar instead of re-deriving it", () => {
  it.each(Object.entries(GRID_BOARDS))(
    "%s declares no cell geometry of its own",
    (_name, sheet) => {
      // The frame, the cell and the state rings all come from BoardGrid now.
      // What is left in these sheets is each game's own layer: marks, stones,
      // the phase prompt, the two-step selection affordances.
      expect(sheet).not.toMatch(/^\.cell\b/m);
      expect(sheet).not.toMatch(/^\.board\b/m);
      expect(sheet).not.toMatch(/^\.row\b/m);
      expect(sheet).not.toMatch(/^\.(winning|winningLoss|lastMove)\b/m);
    },
  );

  it.each([
    ["--board-cell-border", "the pile's border"],
    ["--board-cell-radius", "the pile's corner"],
    ["--board-cell-bg", "the pile's raised surface"],
    ["--board-cell-bg-hover", "the pile's hover wash"],
    ["--board-cell-shadow", "the pile's lift"],
  ])("NimBoard uses %s for %s", (name) => {
    // Nim's pile is not a grid cell, so it does not use BoardGrid — but it is
    // the same raised object, and used to re-derive it from tier-1 by hand.
    expect(nim).toContain(`var(${name})`);
  });

  it.each([
    ["ConnectFourBoard", connectFour],
    ["NimBoard", nim],
  ])("%s draws its state rings at the shared widths", (_name, sheet) => {
    // A "this just moved" ring should read the same weight whatever you are
    // playing, even where the object underneath it is a disc or a pile rather
    // than a cell.
    expect(sheet).toContain("var(--board-ring-width)");
    expect(sheet).toContain("var(--board-pulse-scale)");
  });

  it("leaves no dead var() fallback behind", () => {
    // `var(--radius-full, var(--radius-md))` and friends read as "this token
    // might not exist". All three do exist, and have since the token layer
    // landed — the fallback was cargo, and it hid which value was really in use.
    for (const sheet of [nim, connectFour, boardGrid, ...Object.values(GRID_BOARDS)]) {
      expect(sheet).not.toMatch(/var\(--[\w-]+,\s*var\(/);
    }
  });
});
