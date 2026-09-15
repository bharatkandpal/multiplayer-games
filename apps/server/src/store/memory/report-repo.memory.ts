import type { Report, ReportRepo } from "../ports.js";

/**
 * In-memory report queue (dev + Vitest).
 *
 * Unbounded by design, matching the other memory repos: this backs a
 * short-lived dev process or a test run. Anything durable runs Postgres.
 */
export function createMemoryReportRepo(): ReportRepo {
  const reports: Report[] = [];

  return {
    async create(input) {
      const report: Report = {
        id: crypto.randomUUID(),
        kind: input.kind,
        targetId: input.targetId,
        reason: input.reason ?? null,
        reporterToken: input.reporterToken,
        createdAt: new Date(),
      };
      reports.push(report);
      return report;
    },

    async findByReporter(reporterToken, opts) {
      const owned = reports
        .filter((r) => r.reporterToken === reporterToken)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit ?? 50;
      return owned.slice(offset, offset + limit);
    },

    async deleteByOwner(reporterToken) {
      let count = 0;
      for (let i = reports.length - 1; i >= 0; i--) {
        if (reports[i]!.reporterToken === reporterToken) {
          reports.splice(i, 1);
          count++;
        }
      }
      return count;
    },

    async deleteOlderThan(cutoff) {
      let count = 0;
      for (let i = reports.length - 1; i >= 0; i--) {
        if (reports[i]!.createdAt.getTime() < cutoff.getTime()) {
          reports.splice(i, 1);
          count++;
        }
      }
      return count;
    },
  };
}
