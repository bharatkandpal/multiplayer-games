import { and, eq, lt } from "drizzle-orm";

import type { Database } from "../../db/drizzle.js";
import { shareLinks } from "../../db/schema.js";
import type { NewShareLink, ShareLink, ShareLinkRepo } from "../ports.js";

function toShareLink(row: typeof shareLinks.$inferSelect): ShareLink {
  return {
    id: row.id,
    token: row.token,
    kind: row.kind,
    targetId: row.targetId,
    ownerToken: row.ownerToken,
    eventId: row.eventId,
    expiresAt: row.expiresAt,
    revoked: row.revoked,
    createdAt: row.createdAt,
  };
}

export function createPgShareLinkRepo(db: Database): ShareLinkRepo {
  return {
    async create(input: NewShareLink) {
      const [row] = await db
        .insert(shareLinks)
        .values({
          token: input.token,
          kind: input.kind,
          targetId: input.targetId,
          ownerToken: input.ownerToken,
          eventId: input.eventId ?? null,
          expiresAt: input.expiresAt ?? null,
        })
        .returning();
      return toShareLink(row!);
    },

    async findByToken(token) {
      const [row] = await db
        .select()
        .from(shareLinks)
        .where(and(eq(shareLinks.token, token), eq(shareLinks.revoked, false)))
        .limit(1);

      if (!row) return undefined;

      // Check expiry
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return undefined;

      return toShareLink(row);
    },

    async revoke(token, ownerToken) {
      const rows = await db
        .update(shareLinks)
        .set({ revoked: true })
        .where(and(eq(shareLinks.token, token), eq(shareLinks.ownerToken, ownerToken)))
        .returning({ id: shareLinks.id });
      return rows.length > 0;
    },

    async deleteByOwner(ownerToken) {
      const rows = await db
        .delete(shareLinks)
        .where(eq(shareLinks.ownerToken, ownerToken))
        .returning({ id: shareLinks.id });
      return rows.length;
    },

    async deleteExpired() {
      const rows = await db
        .delete(shareLinks)
        .where(lt(shareLinks.expiresAt, new Date()))
        .returning({ id: shareLinks.id });
      return rows.length;
    },
  };
}
