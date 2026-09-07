import { and, desc, eq, lt } from "drizzle-orm";

import type { Database } from "../../db/drizzle.js";
import { gameResults } from "../../db/schema.js";
import type { GameResult, NewGameResult, PaginationOpts, ResultRepo } from "../ports.js";

function toGameResult(row: typeof gameResults.$inferSelect): GameResult {
  return {
    id: row.id,
    runId: row.runId,
    gameId: row.gameId,
    gameFamily: row.gameFamily,
    eventId: row.eventId,
    ownerToken: row.ownerToken,
    status: row.status,
    winnerSlot: row.winnerSlot,
    score: row.score,
    seatsSnapshot: row.seatsSnapshot,
    durationMs: row.durationMs,
    moveLog: row.moveLog,
    createdAt: row.createdAt,
  };
}

export function createPgResultRepo(db: Database): ResultRepo {
  return {
    async save(input: NewGameResult) {
      const [row] = await db
        .insert(gameResults)
        .values({
          runId: input.runId,
          gameId: input.gameId,
          gameFamily: input.gameFamily ?? "turn-based",
          eventId: input.eventId ?? null,
          ownerToken: input.ownerToken,
          status: input.status,
          winnerSlot: input.winnerSlot ?? null,
          score: input.score ?? null,
          seatsSnapshot: input.seatsSnapshot,
          durationMs: input.durationMs ?? null,
          moveLog: input.moveLog ?? null,
        })
        .onConflictDoNothing({ target: gameResults.runId })
        .returning();

      // On conflict (duplicate runId) the returning() is empty — fetch existing
      if (!row) {
        const [existing] = await db
          .select()
          .from(gameResults)
          .where(eq(gameResults.runId, input.runId))
          .limit(1);
        return toGameResult(existing!);
      }
      return toGameResult(row);
    },

    async findByRunId(runId) {
      const [row] = await db
        .select()
        .from(gameResults)
        .where(eq(gameResults.runId, runId))
        .limit(1);
      return row ? toGameResult(row) : undefined;
    },

    async findByOwner(ownerToken, opts?: PaginationOpts) {
      const rows = await db
        .select()
        .from(gameResults)
        .where(eq(gameResults.ownerToken, ownerToken))
        .orderBy(desc(gameResults.createdAt))
        .limit(opts?.limit ?? 50)
        .offset(opts?.offset ?? 0);
      return rows.map(toGameResult);
    },

    async findByGameAndEvent(gameId, eventId, opts?: PaginationOpts) {
      const conditions = [eq(gameResults.gameId, gameId)];
      if (eventId !== undefined && eventId !== null) {
        conditions.push(eq(gameResults.eventId, eventId));
      }
      const rows = await db
        .select()
        .from(gameResults)
        .where(and(...conditions))
        .orderBy(desc(gameResults.createdAt))
        .limit(opts?.limit ?? 50)
        .offset(opts?.offset ?? 0);
      return rows.map(toGameResult);
    },

    async deleteByOwner(ownerToken) {
      const rows = await db
        .delete(gameResults)
        .where(eq(gameResults.ownerToken, ownerToken))
        .returning({ id: gameResults.id });
      return rows.length;
    },

    async deleteOlderThan(cutoff) {
      const rows = await db
        .delete(gameResults)
        .where(lt(gameResults.createdAt, cutoff))
        .returning({ id: gameResults.id });
      return rows.length;
    },
  };
}
