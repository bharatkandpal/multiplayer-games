/**
 * Client-side leaderboard fetch helpers (MPG-055) and the real-time score
 * submission call (MPG-093).
 *
 * Wraps `GET /api/leaderboard/:gameId`, `GET /api/leaderboard/:gameId/rank`, and
 * `POST /api/leaderboard/:gameId/submit` — see docs/API_SPEC.md. All requests are
 * session-scoped via `apiFetch`.
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

/**
 * A finished real-time run, as submitted for leaderboard scoring.
 *
 * The server never trusts `score`: it re-simulates `{seed, inputLog}` through the
 * same shared `RealtimeModule` and rejects the submission with 422
 * `SCORE_MISMATCH` unless the replay independently reaches game over with the
 * same score. `runId` is client-generated so a retry after a network blip is
 * idempotent rather than a second entry.
 */
export interface ScoreSubmission {
  readonly runId: string;
  readonly seed: number;
  readonly score: number;
  readonly inputLog: readonly unknown[];
  readonly eventId?: string;
  readonly timeBucket?: string;
}

export interface SubmitScoreResponse {
  readonly ok: true;
  /** Present when this `runId` had already been persisted — the write was a no-op. */
  readonly duplicate?: boolean;
  readonly entry: LeaderboardEntry | null;
}

/**
 * Submits a completed real-time run for server-side re-simulation and scoring.
 *
 * Throws on any non-2xx (including a 422 `SCORE_MISMATCH`) so callers can decide
 * how loud to be; the game-over UI treats a failure as non-fatal and silent —
 * a leaderboard write is never worth blocking or interrupting a finished run.
 */
export async function submitRealtimeScore(
  gameId: string,
  submission: ScoreSubmission,
): Promise<SubmitScoreResponse> {
  const res = await apiFetch(`/api/leaderboard/${encodeURIComponent(gameId)}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submission),
  });
  if (!res.ok) {
    throw new Error(`Failed to submit score: ${res.status}`);
  }
  return (await res.json()) as SubmitScoreResponse;
}
