import { eq, sql } from "drizzle-orm";

import type { Database } from "../../db/drizzle.js";
import { identities, sessions } from "../../db/schema.js";
import type { AdoptResult, ClaimResult, Identity, IdentityRepo } from "../ports.js";

function toIdentity(row: typeof identities.$inferSelect): Identity {
  return { id: row.id, handle: row.handle, createdAt: row.createdAt };
}

/** Postgres unique_violation error code (duplicate handle race). */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export function createPgIdentityRepo(db: Database): IdentityRepo {
  return {
    async claim(token, handle, recoveryCodeHash): Promise<ClaimResult> {
      const [session] = await db
        .select({ identityId: sessions.identityId })
        .from(sessions)
        .where(eq(sessions.token, token))
        .limit(1);
      if (session?.identityId) {
        return { ok: false, reason: "already_claimed" };
      }

      // Pre-check for a friendly result; the unique index is the real guard
      // against a concurrent claim of the same handle (caught below).
      const [conflict] = await db
        .select({ id: identities.id })
        .from(identities)
        .where(sql`lower(${identities.handle}) = lower(${handle})`)
        .limit(1);
      if (conflict) {
        return { ok: false, reason: "handle_taken" };
      }

      let identity: Identity;
      try {
        const [row] = await db.insert(identities).values({ handle, recoveryCodeHash }).returning();
        if (!row) throw new Error("claim: identity insert returned no row");
        identity = toIdentity(row);
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }

      await db.update(sessions).set({ identityId: identity.id }).where(eq(sessions.token, token));
      return { ok: true, identity };
    },

    async adopt(token, recoveryCodeHash): Promise<AdoptResult> {
      const [row] = await db
        .select()
        .from(identities)
        .where(eq(identities.recoveryCodeHash, recoveryCodeHash))
        .limit(1);
      if (!row) return { ok: false, reason: "invalid_code" };

      await db.update(sessions).set({ identityId: row.id }).where(eq(sessions.token, token));
      return { ok: true, identity: toIdentity(row) };
    },

    async findByToken(token) {
      const [row] = await db
        .select({
          id: identities.id,
          handle: identities.handle,
          recoveryCodeHash: identities.recoveryCodeHash,
          createdAt: identities.createdAt,
        })
        .from(identities)
        .innerJoin(sessions, eq(sessions.identityId, identities.id))
        .where(eq(sessions.token, token))
        .limit(1);
      return row ? toIdentity(row) : undefined;
    },

    async tokensForIdentity(identityId) {
      const rows = await db
        .select({ token: sessions.token })
        .from(sessions)
        .where(eq(sessions.identityId, identityId));
      return rows.map((r) => r.token);
    },
  };
}
