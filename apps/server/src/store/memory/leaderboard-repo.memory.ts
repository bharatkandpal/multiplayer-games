import type {
  LeaderboardEntry,
  LeaderboardFilter,
  LeaderboardRepo,
  UpsertLeaderboardEntry,
} from "../ports.js";

function compositeKey(
  gameId: string,
  eventId: string | null | undefined,
  timeBucket: string | null | undefined,
  ownerToken: string,
): string {
  return `${gameId}|${eventId ?? ""}|${timeBucket ?? ""}|${ownerToken}`;
}

export function createMemoryLeaderboardRepo(): LeaderboardRepo {
  const store = new Map<string, LeaderboardEntry>();

  function matchesFilter(
    entry: LeaderboardEntry,
    filter?: LeaderboardFilter,
  ): boolean {
    if (!filter) return true;
    if (filter.eventId !== undefined && entry.eventId !== filter.eventId)
      return false;
    if (
      filter.timeBucket !== undefined &&
      entry.timeBucket !== filter.timeBucket
    )
      return false;
    return true;
  }

  /** Sort entries for ranking: score metric = bestScore DESC, wld metric = wins DESC then totalGames DESC. */
  function rankSort(a: LeaderboardEntry, b: LeaderboardEntry): number {
    if (a.metric === "score") {
      return (b.bestScore ?? 0) - (a.bestScore ?? 0);
    }
    // wld: wins DESC, then totalGames DESC
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.totalGames - a.totalGames;
  }

  return {
    async upsert(input: UpsertLeaderboardEntry) {
      const key = compositeKey(
        input.gameId,
        input.eventId,
        input.timeBucket,
        input.ownerToken,
      );
      const existing = store.get(key);

      const entry: LeaderboardEntry = {
        id: existing?.id ?? crypto.randomUUID(),
        gameId: input.gameId,
        metric: input.metric,
        eventId: input.eventId ?? null,
        timeBucket: input.timeBucket ?? null,
        ownerToken: input.ownerToken,
        wins: (existing?.wins ?? 0) + (input.wins ?? 0),
        losses: (existing?.losses ?? 0) + (input.losses ?? 0),
        draws: (existing?.draws ?? 0) + (input.draws ?? 0),
        bestScore:
          input.bestScore !== undefined && input.bestScore !== null
            ? Math.max(existing?.bestScore ?? 0, input.bestScore)
            : (existing?.bestScore ?? null),
        totalGames: (existing?.totalGames ?? 0) + (input.totalGames ?? 0),
        runId: input.runId ?? existing?.runId ?? null,
        updatedAt: new Date(),
      };
      store.set(key, entry);
      return entry;
    },

    async topN(gameId, metric, n, filter) {
      return [...store.values()]
        .filter(
          (e) =>
            e.gameId === gameId && e.metric === metric && matchesFilter(e, filter),
        )
        .sort(rankSort)
        .slice(0, n);
    },

    async rankOf(gameId, metric, ownerToken, filter) {
      const sorted = [...store.values()]
        .filter(
          (e) =>
            e.gameId === gameId && e.metric === metric && matchesFilter(e, filter),
        )
        .sort(rankSort);

      const idx = sorted.findIndex((e) => e.ownerToken === ownerToken);
      return idx === -1 ? undefined : idx + 1; // 1-based
    },

    async deleteByOwner(ownerToken) {
      let count = 0;
      for (const [key, e] of store) {
        if (e.ownerToken === ownerToken) {
          store.delete(key);
          count++;
        }
      }
      return count;
    },

    async deleteByEvent(eventId) {
      let count = 0;
      for (const [key, e] of store) {
        if (e.eventId === eventId) {
          store.delete(key);
          count++;
        }
      }
      return count;
    },
  };
}
