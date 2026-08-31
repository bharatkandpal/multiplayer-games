import type { Database } from "../../db/drizzle.js";
import type { Store } from "../ports.js";
import { createPgLeaderboardRepo } from "./leaderboard-repo.pg.js";
import { createPgResultRepo } from "./result-repo.pg.js";
import { createPgSessionRepo } from "./session-repo.pg.js";
import { createPgShareLinkRepo } from "./share-link-repo.pg.js";

/** Create a Postgres-backed Store from a Drizzle instance. */
export function createPgStore(db: Database): Store {
  return {
    sessions: createPgSessionRepo(db),
    results: createPgResultRepo(db),
    leaderboard: createPgLeaderboardRepo(db),
    shareLinks: createPgShareLinkRepo(db),
  };
}
