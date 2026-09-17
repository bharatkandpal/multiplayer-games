/**
 * Display titles for the share card.
 *
 * A second copy of what `apps/web/src/screens/catalog.ts` already holds, and that is a
 * genuine duplication rather than an oversight: the server cannot import from `apps/web`
 * (the import boundary runs one way — only the frontend is distributable), and the
 * titles do not belong in `packages/engine` either, which is deliberately pure rules
 * with no presentation in it.
 *
 * What stops it rotting is `__tests__/titles.test.ts`, which asserts every id in both
 * engine registries has an entry here. A new game cannot ship a card labelled with its
 * raw slug without a test going red first.
 */

/** Game id → the title a player sees. Covers both families. */
export const GAME_TITLES: Readonly<Record<string, string>> = {
  // Turn-based
  tictactoe: "Tic-Tac-Toe",
  connect4: "Connect Four",
  "tictactoe-move": "Move-Mode Tic-Tac-Toe",
  nim: "Nim",
  gomoku: "Gomoku",
  // Real-time
  "floppy-birds": "Floppy Birds",
  "drunk-walk": "Drunk Walk",
  "reflex-test": "Reflex Test",
  "2048": "2048",
  // 2048 grid-size variants (MPG-096) — separate leaderboards, one shared name.
  "2048@3": "2048 (3×3)",
  "2048@5": "2048 (5×5)",
  breakout: "Breakout",
  snake: "Snake",
  lumberjack: "Lumberjack",
  "memory-sequence": "Memory Sequence",
  "aim-trainer": "Aim Trainer",
};

/**
 * The title for `gameId`, falling back to the raw id.
 *
 * The fallback is honest rather than defensive: a card for a game this build doesn't
 * know still renders and still carries a real score, it just names the game by its slug.
 * Refusing to render — or printing "Unknown game" — would turn a missing table entry
 * into a broken share, which is a far worse trade for a cosmetic label.
 */
export function gameTitle(gameId: string): string {
  return GAME_TITLES[gameId] ?? gameId;
}
