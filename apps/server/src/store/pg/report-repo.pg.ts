import { desc, eq, lt } from "drizzle-orm";

import type { Database } from "../../db/drizzle.js";
import { reports } from "../../db/schema.js";
import type { Report, ReportRepo } from "../ports.js";

function toReport(row: typeof reports.$inferSelect): Report {
  return {
    id: row.id,
    kind: row.kind,
    targetId: row.targetId,
    reason: row.reason,
    reporterToken: row.reporterToken,
    createdAt: row.createdAt,
  };
}

export function createPgReportRepo(db: Database): ReportRepo {
  return {
    async create(input) {
      const [row] = await db
        .insert(reports)
        .values({
          kind: input.kind,
          targetId: input.targetId,
          reason: input.reason ?? null,
          reporterToken: input.reporterToken,
        })
        .returning();
      return toReport(row!);
    },

    async findByReporter(reporterToken, opts) {
      const rows = await db
        .select()
        .from(reports)
        .where(eq(reports.reporterToken, reporterToken))
        .orderBy(desc(reports.createdAt))
        .limit(opts?.limit ?? 50)
        .offset(opts?.offset ?? 0);
      return rows.map(toReport);
    },

    async deleteByOwner(reporterToken) {
      const rows = await db
        .delete(reports)
        .where(eq(reports.reporterToken, reporterToken))
        .returning({ id: reports.id });
      return rows.length;
    },

    async deleteOlderThan(cutoff) {
      const rows = await db
        .delete(reports)
        .where(lt(reports.createdAt, cutoff))
        .returning({ id: reports.id });
      return rows.length;
    },
  };
}
