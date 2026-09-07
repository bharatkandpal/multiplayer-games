import { and, eq, ne, sql } from "drizzle-orm";

import type { Database } from "../../db/drizzle.js";
import { sessions } from "../../db/schema.js";
import type { Session, SessionRepo, SetUsernameResult } from "../ports.js";

function toSession(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    token: row.token,
    username: row.username,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    metadata: row.metadata,
  };
}

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export function createPgSessionRepo(db: Database): SessionRepo {
  return {
    async upsert(token) {
      const [row] = await db
        .insert(sessions)
        .values({ token })
        .onConflictDoUpdate({
          target: sessions.token,
          set: { lastSeenAt: new Date() },
        })
        .returning();
      return toSession(row!);
    },

    async findByToken(token) {
      const [row] = await db.select().from(sessions).where(eq(sessions.token, token)).limit(1);
      return row ? toSession(row) : undefined;
    },

    async touch(token) {
      await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.token, token));
    },

    async delete(token) {
      const result = await db
        .delete(sessions)
        .where(eq(sessions.token, token))
        .returning({ id: sessions.id });
      return result.length > 0;
    },

    async setUsername(token, username): Promise<SetUsernameResult> {
      // Pre-check for a friendly 409 in the common case; the unique index is
      // the real guard against races (caught below).
      const [conflict] = await db
        .select({ token: sessions.token })
        .from(sessions)
        .where(
          and(sql`lower(${sessions.username}) = lower(${username})`, ne(sessions.token, token)),
        )
        .limit(1);

      if (conflict) {
        return { ok: false, reason: "taken" };
      }

      try {
        const [row] = await db
          .update(sessions)
          .set({ username })
          .where(eq(sessions.token, token))
          .returning();

        if (!row) {
          throw new Error(`setUsername: unknown session token`);
        }
        return { ok: true, session: toSession(row) };
      } catch (err) {
        if (isUniqueViolation(err)) {
          return { ok: false, reason: "taken" };
        }
        throw err;
      }
    },
  };
}
