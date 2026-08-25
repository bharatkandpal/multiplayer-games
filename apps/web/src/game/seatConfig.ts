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

/** Exactly two seats — every POC game (Tic-Tac-Toe, Connect Four) is 2-player. */
export type SeatsConfig = readonly [SeatConfig, SeatConfig];

export const DEFAULT_DIFFICULTY: Difficulty = "medium";

/** A sensible starting configuration for the setup screen: human vs. medium bot. */
export function createDefaultSeats(): SeatsConfig {
  return [{ kind: "human" }, { kind: "bot", difficulty: DEFAULT_DIFFICULTY }];
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

/**
 * Display-ready copy for one seat, aware of the other seat so a solo human
 * reads as "You" but a local two-human game reads as "Player 1"/"Player 2"
 * (no seat is privileged over the other on a shared device).
 */
export function describeSeat(seats: SeatsConfig, seatIndex: 0 | 1): string {
  const seat = seats[seatIndex];
  if (seat.kind === "bot") {
    return `${DIFFICULTY_LABEL[seat.difficulty]} bot (Player ${seatIndex + 1})`;
  }
  const humanCount = seats.filter((s) => s.kind === "human").length;
  return humanCount === 1 ? "You" : `Player ${seatIndex + 1}`;
}
