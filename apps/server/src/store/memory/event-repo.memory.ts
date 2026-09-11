import type { AnalyticsEvent, EventCount, EventRepo } from "../ports.js";

/**
 * In-memory analytics events (dev + Vitest).
 *
 * Unbounded by design, matching the other memory repos: this adapter backs a
 * dev process and a test run, both of which are short-lived. Anything that
 * needs to survive a restart is running Postgres.
 */
export function createMemoryEventRepo(): EventRepo {
  const events: AnalyticsEvent[] = [];

  /** `[since, until)` — half-open, so adjacent windows neither overlap nor gap. */
  const inWindow = (e: AnalyticsEvent, since: Date, until: Date): boolean =>
    e.createdAt.getTime() >= since.getTime() && e.createdAt.getTime() < until.getTime();

  return {
    async record(incoming) {
      for (const input of incoming) {
        events.push({
          id: crypto.randomUUID(),
          name: input.name,
          ownerToken: input.ownerToken,
          gameId: input.gameId ?? null,
          shareLinkId: input.shareLinkId ?? null,
          eventId: input.eventId ?? null,
          props: input.props ?? null,
          createdAt: input.createdAt ?? new Date(),
        });
      }
    },

    async countByName(since, until) {
      const counts = new Map<string, number>();
      for (const e of events) {
        if (!inWindow(e, since, until)) continue;
        counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
      }
      const out: EventCount[] = [];
      for (const [name, count] of counts) out.push({ name, count });
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },

    async countDistinctOwners(name, since, until) {
      const owners = new Set<string>();
      for (const e of events) {
        if (e.name === name && inWindow(e, since, until)) owners.add(e.ownerToken);
      }
      return owners.size;
    },

    async deleteByOwner(ownerToken) {
      let count = 0;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]!.ownerToken === ownerToken) {
          events.splice(i, 1);
          count++;
        }
      }
      return count;
    },

    async deleteOlderThan(cutoff) {
      let count = 0;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]!.createdAt.getTime() < cutoff.getTime()) {
          events.splice(i, 1);
          count++;
        }
      }
      return count;
    },
  };
}
