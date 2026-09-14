/**
 * Store factory — selects the persistence adapter based on environment.
 *
 * If `DATABASE_URL` is set → Postgres (prod).
 * Otherwise → in-memory (dev + Vitest, zero external deps).
 */

import type { Store } from "./ports.js";

export type { Store } from "./ports.js";
export type {
  Session,
  SessionRepo,
  Identity,
  ClaimResult,
  AdoptResult,
  IdentityRepo,
  GameResult,
  NewGameResult,
  ResultRepo,
  LeaderboardEntry,
  UpsertLeaderboardEntry,
  LeaderboardFilter,
  LeaderboardRepo,
  ShareLink,
  NewShareLink,
  ShareLinkRepo,
  AnalyticsEvent,
  NewAnalyticsEvent,
  EventCount,
  EventRepo,
  PaginationOpts,
} from "./ports.js";

export async function createStore(): Promise<Store> {
  const dbUrl = process.env["DATABASE_URL"];

  if (dbUrl) {
    // Driver (Neon serverless vs postgres.js) is chosen from the environment —
    // see `db/index.ts`. The store repos are driver-agnostic, so this is the
    // only place the choice is made.
    const { createDatabaseFromEnv } = await import("../db/index.js");
    const { createPgStore } = await import("./pg/index.js");

    const db = await createDatabaseFromEnv();
    return createPgStore(db);
  }

  const { createMemoryStore } = await import("./memory/index.js");
  return createMemoryStore();
}
