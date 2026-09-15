import { and, desc, eq, sql } from "drizzle-orm";

import type { Database } from "../../db/drizzle.js";
import { leaderboardEntries } from "../../db/schema.js";
import type {
  LeaderboardEntry,
  LeaderboardFilter,
  LeaderboardRepo,
  UpsertLeaderboardEntry,
} from "../ports.js";

function toEntry(row: typeof leaderboardEntries.$inferSelect): LeaderboardEntry {
  return {
    id: row.id,
    gameId: row.gameId,
    metric: row.metric,
    eventId: row.eventId,
    timeBucket: row.timeBucket,
    ownerToken: row.ownerToken,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    bestScore: row.bestScore,
    totalGames: row.totalGames,
    runId: row.runId,
    updatedAt: row.updatedAt,
  };
}

function filterConditions(gameId: string, metric: string, filter?: LeaderboardFilter) {
  const conds = [eq(leaderboardEntries.gameId, gameId), eq(leaderboardEntries.metric, metric)];
  if (filter?.eventId !== undefined) {
    conds.push(
      filter.eventId === null
        ? sql`${leaderboardEntries.eventId} IS NULL`
        : eq(leaderboardEntries.eventId, filter.eventId),
    );
  }
  if (filter?.timeBucket !== undefined) {
    conds.push(
      filter.timeBucket === null
        ? sql`${leaderboardEntries.timeBucket} IS NULL`
        : eq(leaderboardEntries.timeBucket, filter.timeBucket),
    );
  }
  return and(...conds);
}

export function createPgLeaderboardRepo(db: Database): LeaderboardRepo {
  return {
    async upsert(input: UpsertLeaderboardEntry) {
      const [row] = await db
        .insert(leaderboardEntries)
        .values({
          gameId: input.gameId,
          metric: input.metric,
          eventId: input.eventId ?? null,
          timeBucket: input.timeBucket ?? null,
          ownerToken: input.ownerToken,
          wins: input.wins ?? 0,
          losses: input.losses ?? 0,
          draws: input.draws ?? 0,
          bestScore: input.bestScore ?? null,
          totalGames: input.totalGames ?? 0,
          runId: input.runId ?? null,
        })
        .onConflictDoUpdate({
          target: [
            leaderboardEntries.gameId,
            leaderboardEntries.eventId,
            leaderboardEntries.timeBucket,
            leaderboardEntries.ownerToken,
          ],
          set: {
            wins: sql`${leaderboardEntries.wins} + ${input.wins ?? 0}`,
            losses: sql`${leaderboardEntries.losses} + ${input.losses ?? 0}`,
            draws: sql`${leaderboardEntries.draws} + ${input.draws ?? 0}`,
            bestScore:
              input.bestScore !== undefined && input.bestScore !== null
                ? sql`GREATEST(${leaderboardEntries.bestScore}, ${input.bestScore})`
                : leaderboardEntries.bestScore,
            totalGames: sql`${leaderboardEntries.totalGames} + ${input.totalGames ?? 0}`,
            runId: input.runId ? sql`${input.runId}` : leaderboardEntries.runId,
            updatedAt: new Date(),
          },
        })
        .returning();
      return toEntry(row!);
    },

    async topN(gameId, metric, n, filter) {
      const orderCol =
        metric === "score" ? desc(leaderboardEntries.bestScore) : desc(leaderboardEntries.wins);

      const rows = await db
        .select()
        .from(leaderboardEntries)
        .where(filterConditions(gameId, metric, filter))
        .orderBy(orderCol, desc(leaderboardEntries.totalGames))
        .limit(n);
      return rows.map(toEntry);
    },

    async rankOf(gameId, metric, ownerToken, filter) {
      // Fetch all matching entries sorted, then find position.
      // For POC scale this is fine. At scale, switch to a window function.
      const all = await this.topN(gameId, metric, 10_000, filter);
      const idx = all.findIndex((e) => e.ownerToken === ownerToken);
      return idx === -1 ? undefined : idx + 1;
    },

    async rankOfBest(gameId, metric, ownerTokens, filter) {
      if (ownerTokens.length === 0) return undefined;
      const owned = new Set(ownerTokens);
      // Same sorted scan as `rankOf`; the first row owned by any of the caller's
      // tokens is their best-placed entry. At scale, switch to a window function.
      const all = await this.topN(gameId, metric, 10_000, filter);
      const idx = all.findIndex((e) => owned.has(e.ownerToken));
      return idx === -1 ? undefined : idx + 1;
    },

    async deleteByOwner(ownerToken) {
      const rows = await db
        .delete(leaderboardEntries)
        .where(eq(leaderboardEntries.ownerToken, ownerToken))
        .returning({ id: leaderboardEntries.id });
      return rows.length;
    },

    async deleteByEvent(eventId) {
      const rows = await db
        .delete(leaderboardEntries)
        .where(eq(leaderboardEntries.eventId, eventId))
        .returning({ id: leaderboardEntries.id });
      return rows.length;
    },
  };
}
