import type { GameResult, NewGameResult, PaginationOpts, ResultRepo } from "../ports.js";

export function createMemoryResultRepo(): ResultRepo {
  const store = new Map<string, GameResult>();

  function paginate(items: GameResult[], opts?: PaginationOpts): GameResult[] {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 50;
    return items.slice(offset, offset + limit);
  }

  return {
    async save(input: NewGameResult) {
      // Idempotent on runId — return existing if already saved
      const existing = store.get(input.runId);
      if (existing) return existing;

      const result: GameResult = {
        id: crypto.randomUUID(),
        runId: input.runId,
        gameId: input.gameId,
        gameFamily: input.gameFamily ?? "turn-based",
        eventId: input.eventId ?? null,
        ownerToken: input.ownerToken,
        status: input.status,
        winnerSlot: input.winnerSlot ?? null,
        score: input.score ?? null,
        seatsSnapshot: input.seatsSnapshot,
        durationMs: input.durationMs ?? null,
        moveLog: input.moveLog ?? null,
        createdAt: new Date(),
      };
      store.set(input.runId, result);
      return result;
    },

    async findByRunId(runId) {
      return store.get(runId);
    },

    async findByOwner(ownerToken, opts) {
      const results = [...store.values()]
        .filter((r) => r.ownerToken === ownerToken)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return paginate(results, opts);
    },

    async findByGameAndEvent(gameId, eventId, opts) {
      const results = [...store.values()]
        .filter((r) => {
          if (r.gameId !== gameId) return false;
          if (eventId !== undefined && eventId !== null) {
            return r.eventId === eventId;
          }
          return true;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return paginate(results, opts);
    },

    async deleteByOwner(ownerToken) {
      let count = 0;
      for (const [key, r] of store) {
        if (r.ownerToken === ownerToken) {
          store.delete(key);
          count++;
        }
      }
      return count;
    },

    async deleteOlderThan(cutoff) {
      let count = 0;
      const cutoffMs = cutoff.getTime();
      for (const [key, r] of store) {
        if (r.createdAt.getTime() < cutoffMs) {
          store.delete(key);
          count++;
        }
      }
      return count;
    },
  };
}
