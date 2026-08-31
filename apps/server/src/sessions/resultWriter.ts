/**
 * Game result persistence — called on `game:over` by the Room Manager
 * (MPG-011) and by the real-time track (e.g. Floppy Birds) on run end.
 */

import type { GameResult, NewGameResult, Store } from "../store/ports.js";

export interface GameOverData {
  /** Idempotency key — one persisted result per run, regardless of retries. */
  readonly runId: string;
  readonly gameId: string;
  /** "turn-based" (default) or "realtime". */
  readonly gameFamily?: string;
  readonly ownerToken: string;
  readonly status: string;
  readonly winnerSlot?: number | null;
  /** Realtime tracks (e.g. Floppy Birds) report a score instead of a winner slot. */
  readonly score?: number | null;
  readonly seatsSnapshot: unknown;
  readonly durationMs?: number | null;
  /** Move log (turn-based) or input log / seed (realtime), for replay/audit. */
  readonly moveLog?: unknown;
  readonly eventId?: string | null;
}

/** Persist a game-over result. Idempotent on `runId`. */
export async function writeGameResult(
  store: Store,
  data: GameOverData,
): Promise<GameResult> {
  const input: NewGameResult = {
    runId: data.runId,
    gameId: data.gameId,
    ...(data.gameFamily !== undefined ? { gameFamily: data.gameFamily } : {}),
    eventId: data.eventId ?? null,
    ownerToken: data.ownerToken,
    status: data.status,
    winnerSlot: data.winnerSlot ?? null,
    score: data.score ?? null,
    seatsSnapshot: data.seatsSnapshot,
    durationMs: data.durationMs ?? null,
    moveLog: data.moveLog ?? null,
  };

  return store.results.save(input);
}
