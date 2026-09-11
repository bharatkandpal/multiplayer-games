/**
 * Leaderboard HTTP endpoints.
 *
 * Mounted behind `createSessionMiddleware` — every request already has
 * `req.sessionToken` resolved, used to compute `yourRank`/rank-of-self.
 *
 * `POST /:gameId/submit` (MPG-065) is the anti-cheat path for real-time (score)
 * games: it re-simulates the client's `{seed, inputLog}` through the deterministic
 * `RealtimeModule` and only writes a leaderboard entry if the replayed run's own
 * score/game-over state matches what the client claimed.
 */

import { Router } from "express";
import type { Request, Response } from "express";

import { getRealtimeGame } from "@mpg/engine";
import type { RealtimeGameId } from "@mpg/engine";

import { noopLimit, type RateLimitFor } from "../middleware/rateLimit.js";
import { writeGameResult } from "../sessions/resultWriter.js";
import type { LeaderboardEntry, LeaderboardFilter, Store } from "../store/ports.js";

/**
 * Cap on a submitted input log's length. The log is re-simulated in an O(n) loop,
 * so an unbounded array is a cheap CPU-abuse vector. 50k ticks is ~14 minutes at
 * 60fps — far past any legitimate run — and stays under the JSON body limit
 * (config.ts) so this length check, not the body parser, is the guard that fires.
 */
const MAX_INPUT_LOG_LENGTH = 50_000;
import { updateLeaderboardForScore } from "./leaderboardWriter.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const DEFAULT_METRIC = "wld";

interface SubmitScoreBody {
  readonly seed?: unknown;
  readonly inputLog?: unknown;
  readonly runId?: unknown;
  readonly score?: unknown;
  readonly eventId?: unknown;
  readonly timeBucket?: unknown;
}

/**
 * Looks up a leaderboard entry for a single owner the same way
 * `GET /leaderboard/:gameId/rank` does — via `rankOf` + a `topN` slice —
 * to avoid adding a new repo method for a single-row lookup.
 */
async function fetchOwnEntry(
  store: Store,
  gameId: string,
  metric: string,
  ownerToken: string,
  filter: LeaderboardFilter,
): Promise<LeaderboardEntry | undefined> {
  const rank = await store.leaderboard.rankOf(gameId, metric, ownerToken, filter);
  if (rank === undefined) return undefined;
  const entries = await store.leaderboard.topN(gameId, metric, rank, filter);
  return entries[rank - 1];
}

function parseLimit(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseMetric(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length > 0 ? value : DEFAULT_METRIC;
}

function parseOptionalString(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function createLeaderboardRouter(store: Store, limit: RateLimitFor = noopLimit): Router {
  const router = Router();

  // GET /api/leaderboard/:gameId — top N entries + the requester's rank.
  router.get("/leaderboard/:gameId", async (req: Request, res: Response) => {
    const gameId = req.params["gameId"] as string;
    const metric = parseMetric(req.query["metric"]);
    const limit = parseLimit(req.query["limit"]);
    const eventId = parseOptionalString(req.query["eventId"]);
    const timeBucket = parseOptionalString(req.query["timeBucket"]);
    const filter = { eventId: eventId ?? null, timeBucket: timeBucket ?? null };

    const entries = await store.leaderboard.topN(gameId, metric, limit, filter);

    const token = req.sessionToken;
    const yourRank = token
      ? await store.leaderboard.rankOf(gameId, metric, token, filter)
      : undefined;

    res.json({ entries, yourRank });
  });

  // GET /api/leaderboard/:gameId/rank — just the requester's rank + entry.
  router.get("/leaderboard/:gameId/rank", async (req: Request, res: Response) => {
    const gameId = req.params["gameId"] as string;
    const metric = parseMetric(req.query["metric"]);
    const eventId = parseOptionalString(req.query["eventId"]);
    const timeBucket = parseOptionalString(req.query["timeBucket"]);
    const filter = { eventId: eventId ?? null, timeBucket: timeBucket ?? null };

    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const rank = await store.leaderboard.rankOf(gameId, metric, token, filter);
    if (rank === undefined) {
      res.json({ rank: null });
      return;
    }

    // Fetch the entry itself by pulling entries up to `rank` and taking the last —
    // avoids adding a new repo method for a single lookup keyed on the same sort.
    const entries = await store.leaderboard.topN(gameId, metric, rank, filter);
    const entry = entries[rank - 1];
    if (!entry) {
      res.json({ rank: null });
      return;
    }

    res.json({ rank, entry });
  });

  // POST /api/leaderboard/:gameId/submit — real-time (score) games only (MPG-065).
  // Server re-simulates {seed, inputLog} through the deterministic engine module and
  // only trusts the client-declared `score` if it matches the replayed outcome AND the
  // replayed run actually reached game over — never the client's word alone.
  router.post("/leaderboard/:gameId/submit", limit("score_submit"), async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const gameId = req.params["gameId"] as string;
    const body = req.body as SubmitScoreBody | undefined;
    const seed = body?.seed;
    const inputLog = body?.inputLog;
    const runId = body?.runId;
    const score = body?.score;
    const eventId = typeof body?.eventId === "string" ? body.eventId : undefined;
    const timeBucket = typeof body?.timeBucket === "string" ? body.timeBucket : undefined;

    if (
      typeof seed !== "number" ||
      !Number.isFinite(seed) ||
      !Array.isArray(inputLog) ||
      inputLog.length > MAX_INPUT_LOG_LENGTH ||
      typeof runId !== "string" ||
      runId.length === 0 ||
      typeof score !== "number" ||
      !Number.isFinite(score)
    ) {
      res.status(400).json({ error: "INVALID_REQUEST" });
      return;
    }

    // `getRealtimeGame` throws on unknown ids — treat that as a client error, not a crash.
    let realtimeModule;
    try {
      realtimeModule = getRealtimeGame(gameId as RealtimeGameId);
    } catch {
      res.status(400).json({ error: "UNKNOWN_GAME" });
      return;
    }

    const filter: LeaderboardFilter = { eventId: eventId ?? null, timeBucket: timeBucket ?? null };

    // Idempotency: a run already persisted for this `runId` is a no-op success, not a
    // re-bump (mirrors `ResultRepo.save`'s runId idempotency used for turn-based games).
    const existing = await store.results.findByRunId(runId);
    if (existing) {
      const entry = await fetchOwnEntry(store, gameId, "score", token, filter);
      res.json({ ok: true, duplicate: true, entry: entry ?? null, resultId: existing.id });
      return;
    }

    // Re-simulate authoritatively — the client's inputLog SHAPE is trusted (each
    // module's `tick` owns interpreting it), but never its claimed OUTCOME.
    let state = realtimeModule.createInitialState(seed);
    for (const input of inputLog) {
      state = realtimeModule.tick(state, input);
    }

    const replayedScore = realtimeModule.getScore(state);
    const replayedGameOver = realtimeModule.isGameOver(state);

    if (!replayedGameOver || replayedScore !== score) {
      res.status(422).json({ error: "SCORE_MISMATCH" });
      return;
    }

    const saved = await writeGameResult(store, {
      runId,
      gameId,
      gameFamily: "realtime",
      ownerToken: token,
      status: "complete",
      score: replayedScore,
      seatsSnapshot: null,
      moveLog: { seed, inputLog },
      eventId: eventId ?? null,
    });

    const entry = await updateLeaderboardForScore(store, {
      gameId,
      ownerToken: token,
      score: replayedScore,
      runId,
      eventId: eventId ?? null,
      timeBucket: timeBucket ?? null,
    });

    // `resultId` is what a durable share link points at (MPG-056) — returning it
    // here saves the client a lookup it has no other way to perform (it knows
    // only its own client-minted `runId`).
    res.json({ ok: true, entry, resultId: saved.id });
  });

  return router;
}
