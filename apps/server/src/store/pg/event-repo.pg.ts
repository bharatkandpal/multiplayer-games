import { and, count, countDistinct, eq, gte, lt } from "drizzle-orm";

import type { Database } from "../../db/drizzle.js";
import { analyticsEvents } from "../../db/schema.js";
import type { EventCount, EventRepo } from "../ports.js";

export function createPgEventRepo(db: Database): EventRepo {
  return {
    async record(incoming) {
      // A zero-length batch is a normal outcome of a flush with nothing
      // queued, not an error — and an empty `values()` is a Drizzle throw.
      if (incoming.length === 0) return;

      await db.insert(analyticsEvents).values(
        incoming.map((input) => ({
          name: input.name,
          ownerToken: input.ownerToken,
          gameId: input.gameId ?? null,
          shareLinkId: input.shareLinkId ?? null,
          eventId: input.eventId ?? null,
          props: input.props ?? null,
          ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        })),
      );
    },

    async countByName(since, until) {
      const rows = await db
        .select({ name: analyticsEvents.name, count: count() })
        .from(analyticsEvents)
        .where(and(gte(analyticsEvents.createdAt, since), lt(analyticsEvents.createdAt, until)))
        .groupBy(analyticsEvents.name)
        .orderBy(analyticsEvents.name);

      return rows.map((r): EventCount => ({ name: r.name, count: Number(r.count) }));
    },

    async countDistinctOwners(name, since, until) {
      const [row] = await db
        .select({ total: countDistinct(analyticsEvents.ownerToken) })
        .from(analyticsEvents)
        .where(
          and(
            eq(analyticsEvents.name, name),
            gte(analyticsEvents.createdAt, since),
            lt(analyticsEvents.createdAt, until),
          ),
        );

      return Number(row?.total ?? 0);
    },

    async deleteByOwner(ownerToken) {
      const rows = await db
        .delete(analyticsEvents)
        .where(eq(analyticsEvents.ownerToken, ownerToken))
        .returning({ id: analyticsEvents.id });
      return rows.length;
    },

    async deleteOlderThan(cutoff) {
      const rows = await db
        .delete(analyticsEvents)
        .where(lt(analyticsEvents.createdAt, cutoff))
        .returning({ id: analyticsEvents.id });
      return rows.length;
    },
  };
}
