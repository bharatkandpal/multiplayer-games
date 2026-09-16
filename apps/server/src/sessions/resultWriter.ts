/**
 * Game result persistence — called on `game:over` by the Room Manager
 * (MPG-011) and by the real-time track (e.g. Floppy Birds) on run end.
 */

import { emit, type EventSink } from "../analytics/sink.js";
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

/**
 * Persist a game-over result. Idempotent on `runId`.
 *
 * Optionally emits `result_saved` (MPG-097) — instrumented here rather than at
 * the two call sites because this is the one choke point every finished game
 * passes through, local and room-backed alike. A denominator that only counted
 * one of those would make the share rate meaningless.
 *
 * The `findByRunId` pre-check exists to keep that denominator honest: `save` is
 * idempotent, so a retried write returns the existing row and would otherwise
 * emit a second `result_saved` for one game. It costs one indexed lookup per
 * completed game — rare enough to be free, and only paid when a sink is wired.
 */
export async function writeGameResult(
  store: Store,
  data: GameOverData,
  sink?: EventSink,
): Promise<GameResult> {
  // The owning session must exist before the result can reference it (MPG-133).
  // Under Postgres `game_results.owner_token` is a real foreign key, and the
  // socket path never created the row: `RoomManager` mints seat tokens with
  // `nanoid()` in memory, and only the HTTP middleware upserts. So every online
  // game failed this insert on an FK violation — silently, because persistence
  // is deliberately fire-and-forget so it can never block play. No result row
  // meant no share target and no leaderboard entry either, since both FK the
  // same table. The in-memory store has no foreign keys, which is why the whole
  // suite stayed green. Upsert is idempotent; the HTTP path just no-ops here.
  await store.sessions.upsert(data.ownerToken);

  const alreadyExisted = sink ? Boolean(await store.results.findByRunId(data.runId)) : false;

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

  const saved = await store.results.save(input);

  if (sink && !alreadyExisted) {
    // Leg 4 denominator: share rate is `share_minted / result_saved`.
    emit(sink, {
      name: "result_saved",
      ownerToken: data.ownerToken,
      gameId: data.gameId,
      eventId: data.eventId ?? null,
      props: { gameFamily: data.gameFamily ?? "turn-based", status: data.status },
    });
  }

  return saved;
}
