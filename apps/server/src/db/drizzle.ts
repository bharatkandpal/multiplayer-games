/**
 * Drizzle ORM instance — the typed query builder backed by postgres.js.
 */

import { drizzle } from "drizzle-orm/postgres-js";

import type { Sql } from "./connection.js";
import * as schema from "./schema.js";

export function createDatabase(sql: Sql) {
  return drizzle(sql, { schema });
}

export type Database = ReturnType<typeof createDatabase>;
