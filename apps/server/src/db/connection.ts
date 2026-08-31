/**
 * Postgres connection via postgres.js.
 *
 * Reads `DATABASE_URL` from the environment. Throws eagerly if missing when
 * called — the caller (store factory) only calls this in Postgres mode.
 */

import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

export function createSql(): Sql {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for Postgres mode. " +
        "Set it in .env or as an env var (see .env.example).",
    );
  }
  return postgres(url, { max: 10 });
}
