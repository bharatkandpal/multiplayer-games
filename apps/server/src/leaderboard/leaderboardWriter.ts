/**
 * Leaderboard updates — called on `game:over` right after `writeGameResult`
 * (MPG-013/014) persists the per-seat `GameResult`. Keeps the leaderboard in
 * sync with results without coupling the room/turn logic to leaderboard
 * shape: callers only need a game outcome (win/loss/draw or score).
 */

import type { LeaderboardEntry, Store } from "../store/ports.js";

export interface LeaderboardUpdateScope {
  readonly gameId: string;
  readonly ownerToken: string;
  readonly runId?: string | null;
  readonly eventId?: string | null;
  readonly timeBucket?: string | null;
}

export type TurnOutcome = "win" | "loss" | "draw";

export interface TurnBasedLeaderboardUpdate extends LeaderboardUpdateScope {
  readonly outcome: TurnOutcome;
}

export interface ScoreLeaderboardUpdate extends LeaderboardUpdateScope {
  readonly score: number;
}

/** Turn-based games (wld metric): +1 to whichever of wins/losses/draws applies. */
export async function updateLeaderboardForTurnBased(
  store: Store,
  data: TurnBasedLeaderboardUpdate,
): Promise<LeaderboardEntry> {
  return store.leaderboard.upsert({
    gameId: data.gameId,
    metric: "wld",
    eventId: data.eventId ?? null,
    timeBucket: data.timeBucket ?? null,
    ownerToken: data.ownerToken,
    wins: data.outcome === "win" ? 1 : 0,
    losses: data.outcome === "loss" ? 1 : 0,
    draws: data.outcome === "draw" ? 1 : 0,
    totalGames: 1,
    runId: data.runId ?? null,
  });
}

/** Real-time games (score metric): bestScore = max(existing, new), +1 total game. */
export async function updateLeaderboardForScore(
  store: Store,
  data: ScoreLeaderboardUpdate,
): Promise<LeaderboardEntry> {
  return store.leaderboard.upsert({
    gameId: data.gameId,
    metric: "score",
    eventId: data.eventId ?? null,
    timeBucket: data.timeBucket ?? null,
    ownerToken: data.ownerToken,
    bestScore: data.score,
    totalGames: 1,
    runId: data.runId ?? null,
  });
}

/**
 * Turn-based room shape needed to compute each human seat's outcome.
 * Kept structurally minimal (no import from `rooms/types.ts`) so this module
 * has no dependency on the room manager — only `Store`.
 */
export interface RoomSeatForLeaderboard {
  readonly slot: number;
  readonly kind: "human" | "bot";
  readonly sessionToken?: string | undefined;
}

export interface TurnBasedGameOverResult {
  readonly status: "win" | "draw";
  readonly winner?: number;
}

/**
 * Updates the wld leaderboard entry for every human seat in a just-finished
 * turn-based room. Mirrors `persistResults` in `rooms/moveHandler.ts`: one
 * upsert per human seat, keyed by that seat's session token.
 */
export async function updateLeaderboardsForTurnBasedGameOver(
  store: Store,
  gameId: string,
  seats: readonly RoomSeatForLeaderboard[],
  result: TurnBasedGameOverResult,
  opts: { runId?: string | null; eventId?: string | null; timeBucket?: string | null } = {},
): Promise<void> {
  const humanSeats = seats.filter(
    (seat): seat is RoomSeatForLeaderboard & { sessionToken: string } =>
      seat.kind === "human" && typeof seat.sessionToken === "string",
  );

  await Promise.all(
    humanSeats.map((seat) => {
      const outcome: TurnOutcome =
        result.status === "draw" ? "draw" : result.winner === seat.slot ? "win" : "loss";

      return updateLeaderboardForTurnBased(store, {
        gameId,
        ownerToken: seat.sessionToken,
        outcome,
        runId: opts.runId ?? null,
        eventId: opts.eventId ?? null,
        timeBucket: opts.timeBucket ?? null,
      });
    }),
  );
}
