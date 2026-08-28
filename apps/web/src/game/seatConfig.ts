// Client-side seat model for local play (MPG-010). Each of a game's two seats is
// configured independently as a human or a bot at a given difficulty — any
// combination is valid: human-vs-bot, human-vs-human (local, same device, turn
// passed back and forth), bot-vs-bot ("watch" mode), and mixed bot levels.
//
// This is deliberately a *client* concept distinct from the server's room/seat
// model (docs/PRD.md §2): it only exists to drive the local-play controller
// before any networking exists.

import type { Difficulty } from "@mpg/engine";

export interface HumanSeatConfig {
  readonly kind: "human";
}

export interface BotSeatConfig {
  readonly kind: "bot";
  readonly difficulty: Difficulty;
}

export type SeatConfig = HumanSeatConfig | BotSeatConfig;

/**
 * A game's seats, one per player — length is driven entirely by the game
 * module's `playerCount` (both current POC games happen to report 2, but
 * nothing here assumes exactly two).
 */
export type SeatsConfig = readonly SeatConfig[];

export const DEFAULT_DIFFICULTY: Difficulty = "medium";

/**
 * A sensible starting configuration for the setup screen: seat 1 is human,
 * every other seat is a bot at `difficulty` (medium by default). `seatCount`
 * should come from the selected game's `playerCount`; defaults to 2 for
 * callers (and tests) that don't need to think about seat count.
 */
export function createDefaultSeats(seatCount = 2, difficulty: Difficulty = DEFAULT_DIFFICULTY): SeatsConfig {
  return Array.from({ length: seatCount }, (_, index) =>
    index === 0 ? { kind: "human" } : { kind: "bot", difficulty },
  );
}

/**
 * The two one-tap opponent presets offered on both the Setup screen and the
 * game-over "play again" actions (MPG-049/MPG-050) — kept as a single source
 * of truth so the two surfaces can't drift out of sync.
 */
export type OpponentPreset = "bot" | "human";

/**
 * Build a fresh seats config for one of the two quick-start presets:
 * "bot" — seat 1 human, every other seat a bot at `difficulty` (medium by
 * default, same as `createDefaultSeats`); "human" — every seat human (local
 * pass-and-play).
 */
export function presetSeats(
  preset: OpponentPreset,
  playerCount = 2,
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
): SeatsConfig {
  return preset === "bot"
    ? createDefaultSeats(playerCount, difficulty)
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

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

/**
 * Display-ready copy for one seat, aware of the other seats so a solo human
 * reads as "You" but a local multi-human game reads as "Player 1"/"Player 2"/…
 * (no seat is privileged over the others on a shared device). Works for any
 * number of seats.
 */
export function describeSeat(seats: SeatsConfig, seatIndex: number): string {
  const seat = seats[seatIndex];
  if (!seat) {
    throw new Error(`describeSeat: no seat at index ${seatIndex} (${seats.length} seat(s) total)`);
  }
  if (seat.kind === "bot") {
    return `${DIFFICULTY_LABEL[seat.difficulty]} bot (Player ${seatIndex + 1})`;
  }
  const humanCount = seats.filter((s) => s.kind === "human").length;
  return humanCount === 1 ? "You" : `Player ${seatIndex + 1}`;
}
