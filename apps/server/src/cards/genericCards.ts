/**
 * The two cards every game gets for free — one per family.
 *
 * A bespoke card (see `drunkWalkCard.ts`) is a nice-to-have; these are the floor, and
 * the reason no shared link unfurls bare. They carry exactly what the result already
 * knows, in the hierarchy the card layout imposes: the brag is the hero, the game is
 * the eyebrow, the context is one quiet line beneath.
 */

import { accentRule, eyebrow, footer, hero, ground, subline, textScrim } from "./layout.js";
import { CABINET, TABLE } from "./palette.js";
import { formatCount, formatDuration, formatUtcDate, svgDocument } from "./svg.js";
import { gameTitle } from "./titles.js";
import { readSeats, type ResultCardInput } from "./types.js";

/**
 * Describes who the result was played against — "vs Bot", "2 players", or nothing.
 *
 * Returns an empty string rather than a guess when `seatsSnapshot` is unreadable: a
 * wrong opponent on a card the player is about to show their friends is worse than a
 * card with one fewer line on it.
 */
export function describeOpponents(snapshot: unknown): string {
  const seats = readSeats(snapshot);
  if (seats.length < 2) return "";
  const humans = seats.filter((seat) => seat.kind === "human").length;
  const bots = seats.length - humans;
  if (humans === 1 && bots >= 1) return bots === 1 ? "vs Bot" : `vs ${bots} bots`;
  if (bots === 0) return `${humans} players`;
  if (humans === 0) return "bots only";
  return `${humans} players, ${bots} bots`;
}

/**
 * Real-time result: the score is the whole card.
 *
 * Deliberately no rank, no percentile and no personal best — not because they wouldn't
 * help (they are exactly what MPG-095 exists to add, and a bare number really is hard
 * to judge), but because none of them are in `ResultCardInput`, and a card is cached
 * immutably. Baking "#4 of 210" into a permanent image guarantees it will be wrong
 * within the hour.
 */
export function renderRealtimeCard(result: ResultCardInput): string {
  const g = CABINET;
  const title = gameTitle(result.gameId);
  const score = formatCount(result.score ?? 0);
  const duration = result.durationMs !== null ? formatDuration(result.durationMs) : "";

  const body = [
    ground(g, "cabinet"),
    textScrim(g),
    eyebrow(title, g),
    accentRule(g),
    hero(score, g, true),
    subline(duration ? `points · survived ${duration}` : "points", g),
    footer(formatUtcDate(result.createdAt), g),
  ].join("");

  return svgDocument(`${score} points on ${title}`, body);
}

/**
 * Turn-based result: the verdict is the hero.
 *
 * **Spoiler-free by construction** (PRD FR-23): this renders who won, never how. No
 * board, no winning line, no move count — `moveLog` isn't even reachable from
 * `ResultCardInput`. Someone who opens the link can still play the game fresh.
 *
 * Says "Player N" rather than a name because results carry no handles yet (MPG-091);
 * when they do, this line is the one place that changes.
 */
export function renderTurnBasedCard(result: ResultCardInput): string {
  const g = TABLE;
  const title = gameTitle(result.gameId);

  const verdict =
    result.winnerSlot !== null
      ? `Player ${result.winnerSlot} won`
      : result.status === "in_progress"
        ? "Unfinished"
        : "Draw";

  const opponents = describeOpponents(result.seatsSnapshot);

  const body = [
    ground(g, "table"),
    textScrim(g),
    eyebrow(title, g),
    accentRule(g),
    // The verdict is prose, so it takes the display voice, not the data voice.
    hero(verdict, g, false),
    subline(opponents || title, g),
    footer(formatUtcDate(result.createdAt), g),
  ].join("");

  return svgDocument(`${verdict} at ${title}`, body);
}
