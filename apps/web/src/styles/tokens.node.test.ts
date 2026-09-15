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
