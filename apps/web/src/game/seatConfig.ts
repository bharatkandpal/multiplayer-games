// Client-side seat model for local play (MPG-010). Each of a game's two seats is
// configured independently as a human or a bot at a given difficulty — any
// combination is valid: human-vs-bot, human-vs-human (local, same device, turn
// passed back and forth), bot-vs-bot ("watch" mode), and mixed bot levels.
//
// This is deliberately a *client* concept distinct from the server's room/seat
// model (docs/PRD.md §2): it only exists to drive the local-play controller
// before any networking exists.

import type { Difficulty, GameId } from "@mpg/engine";

import { pickBotName } from "./botNames.js";

export interface HumanSeatConfig {
  readonly kind: "human";
}

export interface BotSeatConfig {
  readonly kind: "bot";
  readonly difficulty: Difficulty;
  /**
   * A display name from the fixed bot roster (see `botNames.ts`), assigned when
   * the seat is created for real play so the opponent reads as a named
   * character. Optional: hand-built configs (mostly tests) leave it unset and
   * fall back to the generic "Bot" in {@link describeSeat}.
   */
  readonly name?: string;
}

export type SeatConfig = HumanSeatConfig | BotSeatConfig;

/**
 * A game's seats, one per player — length is driven entirely by the game
 * module's `playerCount` (both current POC games happen to report 2, but
 * nothing here assumes exactly two).
 */
export type SeatsConfig = readonly SeatConfig[];

/**
 * The strength every bot plays at unless its game overrides it below.
 *
 * There is no user-facing difficulty selector any more: a player picks a game
 * and plays, and the bot is simply "the bot". `Difficulty` survives as an
 * *engine* concept (`DIFFICULTY_TABLE` in `@mpg/engine`) because the search
 * depth/blunder tuning still lives there — this module is the one place that
 * decides which of those tunings each game actually gets.
 */
export const DEFAULT_BOT_DIFFICULTY: Difficulty = "hard";

/**
 * Per-game overrides of {@link DEFAULT_BOT_DIFFICULTY}.
 *
 * Both entries here exist because their Hard tuning is *unbeatable*, not merely
 * strong, which makes for a bad first session:
 *
 * - `tictactoe` — Hard is `maxDepth: 9`, a full unbounded search of a ≤9-ply
 *   tree, documented in the engine as "provably never-losing". A human's best
 *   possible outcome is a draw, every single game.
 * - `nim` — Hard is the exact nim-sum optimum, and the default pile layout
 *   `[1,3,5,7]` has nim-sum 0 (a P-position), so the player — who is always
 *   seated first — is theoretically lost from the opening position with no
 *   counterplay available (see MPG-083).
 *
 * Medium keeps both winnable by carrying a nonzero blunder rate off the same
 * search. Removing an entry here is a product decision, not a cleanup: it makes
 * that game unwinnable against its own bot.
 */
const BOT_DIFFICULTY_BY_GAME: Partial<Record<GameId, Difficulty>> = {
  tictactoe: "medium",
  nim: "medium",
};

/**
 * The difficulty bots play at for `gameId`. Games with no override — and
 * callers with no game in hand — get {@link DEFAULT_BOT_DIFFICULTY}.
 *
 * Takes a plain `string` rather than `GameId` so the play screens (which carry
 * their game id as a string, for the leaderboard) can call it without a cast.
 * An id that isn't in the override table simply misses and gets the default,
 * which is the same answer a genuinely-unlisted game should get.
 */
export function botDifficultyFor(gameId?: string): Difficulty {
  return (gameId ? BOT_DIFFICULTY_BY_GAME[gameId as GameId] : undefined) ?? DEFAULT_BOT_DIFFICULTY;
}

/**
 * A sensible starting configuration: seat 1 is human, every other seat is a bot
 * at `gameId`'s tuned strength. `seatCount` should come from the selected
 * game's `playerCount`; defaults to 2 for callers (and tests) that don't need
 * to think about seat count.
 */
export function createDefaultSeats(seatCount = 2, gameId?: string): SeatsConfig {
  const difficulty = botDifficultyFor(gameId);
  return assignBotNames(
    Array.from({ length: seatCount }, (_, index) =>
      index === 0 ? { kind: "human" } : { kind: "bot", difficulty },
    ),
  );
}

/**
 * Give every bot seat that lacks one a distinct name from the roster (see
 * `botNames.ts`), leaving already-named bots and all human seats untouched.
 * Applied wherever real-play seats are built (defaults, presets, the Setup
 * toggle) so a bot is always a named character on screen; hand-built configs
 * that skip this stay anonymous "Bot"s. `rng` is injectable for deterministic
 * tests.
 */
export function assignBotNames(seats: SeatsConfig, rng: () => number = Math.random): SeatsConfig {
  const used = new Set<string>();
  for (const seat of seats) {
    if (seat.kind === "bot" && seat.name) used.add(seat.name);
  }
  return seats.map((seat) => {
    if (seat.kind !== "bot" || seat.name) return seat;
    const name = pickBotName(used, rng);
    used.add(name);
    return { ...seat, name };
  });
}

/**
 * The two one-tap opponent presets offered on both the Setup screen and the
 * game-over "play again" actions (MPG-049/MPG-050) — kept as a single source
 * of truth so the two surfaces can't drift out of sync.
 */
export type OpponentPreset = "bot" | "human";

/**
 * Build a fresh seats config for one of the two quick-start presets:
 * "bot" — seat 1 human, every other seat a bot at `gameId`'s tuned strength;
 * "human" — every seat human (local pass-and-play).
 */
export function presetSeats(preset: OpponentPreset, playerCount = 2, gameId?: string): SeatsConfig {
  return preset === "bot"
    ? createDefaultSeats(playerCount, gameId)
    : Array.from({ length: playerCount }, () => ({ kind: "human" as const }));
}

/**
 * Compares two seat configs by shape only — same length, same `kind` at each
 * index — ignoring bot difficulty (MPG-050: used to decide whether an
 * opponent preset would just recreate the current game, e.g. "Play vs Bot"
 * offered again on an already human-vs-bot game).
 */
export function sameSeatKinds(a: SeatsConfig, b: SeatsConfig): boolean {
  return a.length === b.length && a.every((seat, i) => seat.kind === b[i]?.kind);
}

/**
 * Display-ready copy for one seat, aware of the other seats so a solo human
 * reads as "You" but a local multi-human game reads as "Player 1"/"Player 2"/…
 * (no seat is privileged over the others on a shared device). Works for any
 * number of seats.
 *
 * Bots are described without a strength label: difficulty is no longer a
 * player-facing concept, so surfacing "Hard bot" here would name a control that
 * doesn't exist any more (and would read as inconsistent across games, since
 * `botDifficultyFor` deliberately varies it).
 */
export function describeSeat(seats: SeatsConfig, seatIndex: number): string {
  const seat = seats[seatIndex];
  if (!seat) {
    throw new Error(`describeSeat: no seat at index ${seatIndex} (${seats.length} seat(s) total)`);
  }
  if (seat.kind === "bot") {
    if (seat.name) return seat.name;
    const botCount = seats.filter((s) => s.kind === "bot").length;
    return botCount === 1 ? "Bot" : `Bot (Player ${seatIndex + 1})`;
  }
  const humanCount = seats.filter((s) => s.kind === "human").length;
  return humanCount === 1 ? "You" : `Player ${seatIndex + 1}`;
}
