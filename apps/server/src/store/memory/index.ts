import type { Store } from "../ports.js";
import { createMemoryLeaderboardRepo } from "./leaderboard-repo.memory.js";
import { createMemoryResultRepo } from "./result-repo.memory.js";
import { createMemorySessionRepo } from "./session-repo.memory.js";
import { createMemoryShareLinkRepo } from "./share-link-repo.memory.js";

/** Create a fully in-memory Store — no DB required. Used for dev + Vitest. */
export function createMemoryStore(): Store {
  return {
    sessions: createMemorySessionRepo(),
    results: createMemoryResultRepo(),
    leaderboard: createMemoryLeaderboardRepo(),
    shareLinks: createMemoryShareLinkRepo(),
  };
}
