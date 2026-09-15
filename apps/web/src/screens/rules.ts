// How each game is played, in the player's own words (MPG-138).
//
// Separate from `catalog.ts` on purpose. A catalog `description` is a *pitch* —
// one line on a card, written to make someone tap it. Rules are *instructions*,
// read at the moment of play by someone who has already chosen the game and now
// needs to know what a turn even is. Conflating the two gives you a card too
// long to scan and a rules sheet too vague to act on.
//
// Content, not logic: nothing here is derived from the engine, and nothing in
// the engine reads it. That's deliberate — rules prose has to say what a player
// should *do*, which no amount of introspection over a move type will produce.
// The cost is that it can drift from the implementation, which is why each entry
// stays short enough to re-read whenever its game changes.

import type { GameId, RealtimeGameId } from "@mpg/engine";

export interface GameRules {
  /** One sentence: what winning (or surviving) looks like. Always present. */
  readonly goal: string;
  /**
   * The mechanics, in the order a player meets them — what a turn is, what a
   * tap does, how it ends. Kept to a handful: a rules sheet nobody finishes
   * reading is a rules sheet nobody read.
   */
  readonly steps: readonly string[];
  /**
   * The quirks that surprise people: an unusual draw condition, a way to lose
   * you wouldn't guess, the one tip worth giving. Optional — most games don't
   * need any, and inventing filler here just buries the steps above.
   */
  readonly notes?: readonly string[];
}

export const GAME_RULES: Partial<Record<GameId, GameRules>> = {
  tictactoe: {
    goal: "Get three of your marks in a row — across, down, or diagonally.",
    steps: [
      "Players take turns. X goes first.",
      "On your turn, tap any empty square to place your mark.",
      "Three in a row wins. If the board fills up with no line, it's a draw.",
    ],
  },
  connect4: {
    goal: "Line up four of your discs — across, down, or diagonally.",
    steps: [
      "Tap a column to drop one of your discs into it.",
      "Discs stack from the bottom, so the only slot you can play in a column is the lowest empty one.",
      "First to four in a line wins. A full board with no line is a draw.",
    ],
    notes: [
      "Blocking counts as much as building — watch the column where your opponent is one disc short.",
    ],
  },
  "tictactoe-move": {
    goal: "Get your three pieces in a row — and you only ever have three.",
    steps: [
      "Take turns placing your three pieces on empty squares.",
      "Once all six are down, a turn means moving one of your own pieces to any empty square.",
      "Three in a row wins.",
    ],
    notes: [
      "The board never fills up, so there's no draw by running out of room. Repeating the same position three times is a draw instead.",
    ],
  },
  nim: {
    goal: "Take the last object and you win.",
    steps: [
      "The four piles start with 1, 3, 5 and 7 objects.",
      "On your turn, choose one pile and take as many objects from it as you like — at least one.",
      "You can only take from a single pile per turn.",
      "Whoever takes the very last object wins.",
    ],
    notes: [
      "There's a perfect strategy hiding in here. The bot knows it — see if you can find it.",
    ],
  },
  gomoku: {
    goal: "Be the first to line up five stones in a row.",
    steps: [
      "Take turns placing one stone on any empty point of the 9x9 board.",
      "Stones never move once they're placed.",
      "Five in a row — across, down, or diagonally — wins.",
    ],
  },
};

export const REALTIME_RULES: Partial<Record<RealtimeGameId, GameRules>> = {
  "floppy-birds": {
    goal: "Fly as far as you can without hitting anything.",
    steps: [
      "Tap the play area (or press Space) to flap upward.",
      "Do nothing and the bird falls — every gap needs its own tap.",
      "Each pipe you clear scores a point. Touch a pipe, the ground or the ceiling and the run is over.",
    ],
  },
  "drunk-walk": {
    goal: "Keep the walker upright for as long as you can.",
    steps: [
      "The walker leans on its own, a little further with every step.",
      "Tap the side opposite the lean to straighten up.",
      "Tap the same side as the lean and it gets worse. Lean too far and the run ends.",
    ],
  },
  "reflex-test": {
    goal: "React the instant the screen turns green.",
    steps: [
      "Wait while it's red — the wait is a different length every round, so it can't be timed.",
      "The moment it turns green, tap.",
      "Five rounds, then you get your best and your average.",
    ],
    notes: ["Tap while it's still red and the run ends there. Anticipating isn't reacting."],
  },
  "2048": {
    goal: "Merge tiles to build the biggest number you can.",
    steps: [
      "Swipe (or use the arrow keys) to slide every tile that way at once.",
      "Two tiles showing the same number merge into one worth double, and that number is added to your score.",
      "A new tile appears after any move that changed the board.",
      "The run ends when the board is full and nothing can merge.",
    ],
  },
  breakout: {
    goal: "Break the wall of bricks without losing your ball.",
    steps: [
      "Move the paddle to keep the ball in play.",
      "Every brick the ball hits scores points.",
      "Clear the wall and a fresh, faster one drops in.",
      "Let the ball past you and you lose a life. Three lives and the run is over.",
    ],
  },
};

/**
 * The rules for a game id, or `undefined` when none are written.
 *
 * Undefined is a supported answer, not a bug: a game can reach the play screen
 * before anyone writes its rules, and the screen then simply offers no Rules
 * control (UX_PRINCIPLES §7 — degrade to absence). A button opening an empty
 * sheet would be worse than no button.
 *
 * Takes a plain `string` because that's what the play screens hold (`gameId` is
 * widened by the time it reaches them) — an unknown id lands on the same
 * `undefined` as an unwritten one.
 */
export function rulesFor(gameId: string): GameRules | undefined {
  // Registered variants carry a suffix (`2048@3`, `2048@5`) and are the same
  // game with a different board size, so they share one set of rules.
  const baseId = gameId.split("@")[0] ?? gameId;
  return GAME_RULES[baseId as GameId] ?? REALTIME_RULES[baseId as RealtimeGameId];
}
