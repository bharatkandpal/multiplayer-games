import { desc, eq } from "drizzle-orm";

import type { Database } from "../../db/drizzle.js";
import { variants } from "../../db/schema.js";
import type { Variant, VariantRepo } from "../ports.js";

function toVariant(row: typeof variants.$inferSelect): Variant {
  return {
    id: row.id,
    name: row.name,
    ownerToken: row.ownerToken,
    baseGameId: row.baseGameId,
    // `cosmetics` is stored as opaque jsonb; the shape guard at the save route
    // (MPG-089-b) is what keeps it a flat string→string map on the way in.
    cosmetics: row.cosmetics as Readonly<Record<string, string>>,
    forkedFrom: row.forkedFrom,
    createdAt: row.createdAt,
  };
}

export function createPgVariantRepo(db: Database): VariantRepo {
  return {
    async create(input) {
      const [row] = await db
        .insert(variants)
        .values({
          name: input.name,
          ownerToken: input.ownerToken,
          baseGameId: input.baseGameId,
          cosmetics: input.cosmetics,
          forkedFrom: input.forkedFrom ?? null,
        })
        .returning();
      return toVariant(row!);
    },

    async findById(id) {
      const [row] = await db.select().from(variants).where(eq(variants.id, id)).limit(1);
      return row ? toVariant(row) : undefined;
    },

    async findByOwner(ownerToken, opts) {
      const rows = await db
        .select()
        .from(variants)
        .where(eq(variants.ownerToken, ownerToken))
        .orderBy(desc(variants.createdAt))
        .limit(opts?.limit ?? 50)
        .offset(opts?.offset ?? 0);
      return rows.map(toVariant);
    },

    async deleteByOwner(ownerToken) {
      const rows = await db
        .delete(variants)
        .where(eq(variants.ownerToken, ownerToken))
        .returning({ id: variants.id });
      return rows.length;
    },
  };
}
