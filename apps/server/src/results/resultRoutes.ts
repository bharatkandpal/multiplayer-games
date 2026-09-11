/**
 * Client-reported turn-based results (MPG-131).
 *
 * Room-backed games already persist a result server-side (`rooms/moveHandler.ts`),
 * because the server applied every move itself. **Local** play — vs-bot and
 * hot-seat, the default path off Home — runs entirely in the browser against the
 * shared engine and touches no room, so nothing existed for a durable share link
 * (MPG-056) to point at. That made leg 5 of the loop unreachable for most of the
 * turn-based catalogue. This route closes that gap.
 *
 * The one rule that shapes the file: **the client's claimed OUTCOME is never
 * trusted.** It sends the move log; the server replays it through the same pure
 * `GameModule` and derives `status`/`winnerSlot` from its own final position —
 * exactly the posture `POST /api/leaderboard/:gameId/submit` takes for real-time
 * runs (MPG-065), just with `applyMove` in place of `tick`.
 *
 * Deliberately NOT wired to the leaderboard. A local game is played against a bot
 * you chose the difficulty of, or against someone on your own sofa; ranking it
 * next to room games would make the board meaningless. This route exists to give a
 * finished local game something shareable, nothing more.
 */

import { Router } from "express";
import type { Request, Response } from "express";

import { getGame, IllegalMoveError } from "@mpg/engine";
import type { GameId } from "@mpg/engine";

import { writeGameResult } from "../sessions/resultWriter.js";
import type { Store } from "../store/ports.js";

/**
 * Replay length ceiling. Well past any real game in the catalogue (Gomoku's 9x9
 * board tops out at 81 moves; move-mode Tic-Tac-Toe can shuffle for a while but
 * draws by threefold repetition long before this), and low enough that the
 * synchronous replay below can't be turned into a CPU-exhaustion lever on an
 * endpoint that is, until MPG-021 lands, unauthenticated and unthrottled.
 */
const MAX_MOVES = 500;

interface SubmitResultBody {
  readonly runId?: unknown;
  readonly gameId?: unknown;
  readonly moveLog?: unknown;
  readonly seatsSnapshot?: unknown;
  readonly durationMs?: unknown;
}

/** One replayed move: who played it (1-based slot) and the game-native move value. */
interface MoveLogEntry {
  readonly slot: number;
  readonly move: unknown;
}

function parseMoveLog(raw: unknown): MoveLogEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MOVES) return undefined;
  const entries: MoveLogEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return undefined;
    const entry = item as Record<string, unknown>;
    const slot = entry["slot"];
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 1) return undefined;
    if (!("move" in entry)) return undefined;
    entries.push({ slot, move: entry["move"] });
  }
  return entries;
}

/**
 * A seat row as persisted. Rebuilt field-by-field rather than stored as sent:
 * `seatsSnapshot` is echoed back to strangers by `GET /api/share/:token`, so
 * whatever lands in the column has to be a shape this file chose, not arbitrary
 * client JSON riding along inside a `jsonb` blob.
 */
interface SeatSnapshot {
  readonly slot: number;
  readonly kind: "human" | "bot";
  readonly difficulty?: string;
}

function parseSeatsSnapshot(raw: unknown, playerCount: number): SeatSnapshot[] | undefined {
  if (!Array.isArray(raw) || raw.length !== playerCount) return undefined;
  const seats: SeatSnapshot[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return undefined;
    const seat = item as Record<string, unknown>;
    const slot = seat["slot"];
    const kind = seat["kind"];
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 1 || slot > playerCount) {
      return undefined;
    }
    if (kind !== "human" && kind !== "bot") return undefined;
    const difficulty = seat["difficulty"];
    seats.push({
      slot,
      kind,
      ...(kind === "bot" && typeof difficulty === "string" ? { difficulty } : {}),
    });
  }
  return seats;
}

function parseDurationMs(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return Math.round(raw);
}

export function createResultRouter(store: Store): Router {
  const router = Router();

  // POST /api/results — persist a finished LOCAL turn-based game, validated by replay.
  router.post("/results", async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const body = req.body as SubmitResultBody | undefined;
    const runId = body?.runId;
    const gameId = body?.gameId;
    const moveLog = parseMoveLog(body?.moveLog);
    const durationMs = parseDurationMs(body?.durationMs);

    if (
      typeof runId !== "string" ||
      runId.length === 0 ||
      runId.length > 128 ||
      typeof gameId !== "string" ||
      !moveLog ||
      durationMs === undefined
    ) {
      res.status(400).json({ error: "INVALID_REQUEST" });
      return;
    }

    // `getGame` throws on an unregistered id — a client error, not a crash.
    let game;
    try {
      game = getGame(gameId as GameId);
    } catch {
      res.status(400).json({ error: "UNKNOWN_GAME" });
      return;
    }

    const seatsSnapshot = parseSeatsSnapshot(body?.seatsSnapshot, game.playerCount);
    if (!seatsSnapshot) {
      res.status(400).json({ error: "INVALID_SEATS" });
      return;
    }

    // Namespaced so a client-minted id can never collide with — or be aimed at —
    // a room's server-minted `${roomId}:${slot}` key.
    const storedRunId = `local:${runId}`;

    // Idempotent on `runId`, so a retry after a network blip is a no-op rather
    // than a second row. Scoped to the owner: another session re-posting the same
    // id is a conflict, not a peek at someone else's result id.
    const existing = await store.results.findByRunId(storedRunId);
    if (existing) {
      if (existing.ownerToken !== token) {
        res.status(409).json({ error: "RUN_ID_TAKEN" });
        return;
      }
      res.json({ ok: true, duplicate: true, resultId: existing.id });
      return;
    }

    // Authoritative replay. `applyMove` enforces turn order and legality itself
    // (it throws `IllegalMoveError` when the slot isn't to move), so a forged log
    // fails here rather than being written and later shared as fact.
    let state = game.createInitialState();
    try {
      for (const entry of moveLog) {
        if (game.getResult(state).status !== "in_progress") {
          res.status(422).json({ error: "REPLAY_MISMATCH" });
          return;
        }
        state = game.applyMove(state, entry.move, entry.slot);
      }
    } catch (err) {
      if (err instanceof IllegalMoveError) {
        res.status(422).json({ error: "REPLAY_MISMATCH" });
        return;
      }
      throw err;
    }

    // Only a FINISHED game is worth a durable link — an abandoned position has no
    // outcome to brag about, and would render as a headline nobody can parse.
    const result = game.getResult(state);
    if (result.status === "in_progress") {
      res.status(422).json({ error: "GAME_NOT_OVER" });
      return;
    }

    const saved = await writeGameResult(store, {
      runId: storedRunId,
      gameId,
      gameFamily: "turn-based",
      ownerToken: token,
      // Derived from the server's own replayed position, never from the request.
      status: result.status,
      winnerSlot: result.status === "win" ? result.winner : null,
      seatsSnapshot,
      durationMs,
      moveLog,
    });

    // `resultId` is what a durable share link points at (MPG-056) — the client
    // knows only its own `runId`, so returning it here saves a lookup it has no
    // other way to perform.
    res.status(201).json({ ok: true, resultId: saved.id });
  });

  return router;
}
