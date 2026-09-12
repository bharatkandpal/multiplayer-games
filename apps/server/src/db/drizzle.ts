/**
 * Drizzle ORM instance — the typed query builder.
 *
 * `Database` is deliberately the driver-agnostic base type, not the concrete
 * `PostgresJsDatabase`. The store repos only ever use the core query builders
 * (`select` / `insert` / `update` / `delete`) — no transactions, no relational
 * `.query` — so every driver's Drizzle handle is assignable to this, and the
 * repos stay interchangeable behind the seam. That is what lets the same store
 * run on postgres.js in the long-running container and on the Neon serverless
 * HTTP driver in the Vercel functions (see `./neon.ts` and `./index.ts`).
 */

import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { Sql } from "./connection.js";
import * as schema from "./schema.js";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Postgres.js-backed Drizzle handle — the driver the container uses. */
export function createDatabase(sql: Sql): Database {
  return drizzle(sql, { schema });
}
