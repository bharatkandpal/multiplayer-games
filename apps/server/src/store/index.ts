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
    const { createSql } = await import("../db/connection.js");
    const { createDatabase } = await import("../db/drizzle.js");
    const { createPgStore } = await import("./pg/index.js");

    const sql = createSql();
    const db = createDatabase(sql);
    return createPgStore(db);
  }

  const { createMemoryStore } = await import("./memory/index.js");
  return createMemoryStore();
}
