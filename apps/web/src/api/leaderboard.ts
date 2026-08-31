/**
 * Client-side leaderboard fetch helpers (MPG-055).
 *
 * Wraps `GET /api/leaderboard/:gameId` and `GET /api/leaderboard/:gameId/rank`
 * — see docs/API_SPEC.md. All requests are session-scoped via `apiFetch`.
 */

import { apiFetch } from "./session";

/** Mirrors the server's `LeaderboardEntry` (store/ports.ts), with dates as ISO strings over the wire. */
export interface LeaderboardEntry {
  readonly id: string;
  readonly gameId: string;
  readonly metric: string;
  readonly eventId: string | null;
  readonly timeBucket: string | null;
  readonly ownerToken: string;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly bestScore: number | null;
  readonly totalGames: number;
  readonly runId: string | null;
  readonly updatedAt: string;
}

export interface LeaderboardResponse {
  readonly entries: LeaderboardEntry[];
  readonly yourRank?: number;
}

export type RankResponse = { rank: number; entry: LeaderboardEntry } | { rank: null };

export interface LeaderboardQuery {
  readonly metric?: string;
  readonly limit?: number;
  readonly eventId?: string;
  readonly timeBucket?: string;
}

function buildQuery(query: LeaderboardQuery = {}): string {
  const params = new URLSearchParams();
  if (query.metric) params.set("metric", query.metric);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.eventId) params.set("eventId", query.eventId);
  if (query.timeBucket) params.set("timeBucket", query.timeBucket);
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/** Fetches the top-N leaderboard entries for `gameId`, plus the caller's own rank if listed. */
export async function fetchLeaderboard(
  gameId: string,
  query: LeaderboardQuery = {},
): Promise<LeaderboardResponse> {
  const res = await apiFetch(`/api/leaderboard/${encodeURIComponent(gameId)}${buildQuery(query)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch leaderboard: ${res.status}`);
  }
  return (await res.json()) as LeaderboardResponse;
}

/** Fetches just the caller's own rank (+ entry) for `gameId`, without the full board. */
export async function fetchYourRank(
  gameId: string,
  query: LeaderboardQuery = {},
): Promise<RankResponse> {
  const res = await apiFetch(
    `/api/leaderboard/${encodeURIComponent(gameId)}/rank${buildQuery(query)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch rank: ${res.status}`);
  }
  return (await res.json()) as RankResponse;
}
