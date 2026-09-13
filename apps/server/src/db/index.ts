/**
 * Database driver selection — the adapter seam between the two deployments.
 *
 * The store repos are written against the driver-agnostic `Database` type
 * (see `./drizzle.ts`), so which concrete driver backs them is a runtime choice
 * made here from the environment:
 *
 *   • **Neon serverless (HTTP)** — connectionless, for the Vercel functions.
 *   • **postgres.js** — pooled TCP, for the long-running container.
 *
 * Selection order: an explicit `DB_DRIVER` wins; otherwise a Neon host in
 * `DATABASE_URL` auto-selects the Neon driver; everything else uses postgres.js.
 * The auto-detect means pointing `DATABASE_URL` at a Neon database "just works"
 * on the functions without a second env var, while a self-hosted Postgres in the
 * container stays on postgres.js by default.
 */

import type { Database } from "./drizzle.js";

export type DbDriver = "neon" | "postgres";

/** Resolve which driver to use, honoring an explicit `DB_DRIVER` override. */
export function resolveDbDriver(url: string): DbDriver {
  const explicit = process.env["DB_DRIVER"];
  if (explicit === "neon" || explicit === "postgres") return explicit;
  // Neon's pooled (`-pooler`), direct, and API endpoints all live under
  // *.neon.tech — a match is a strong signal the serverless driver is wanted.
  return /\.neon\.tech/i.test(url) ? "neon" : "postgres";
}

/**
 * Build a `Database` from `DATABASE_URL`, choosing the driver via
 * {@link resolveDbDriver}. Throws if the URL is missing — callers only reach
 * this in Postgres mode (the store factory falls back to in-memory otherwise).
 * The drivers are imported lazily so neither package is loaded (nor required to
 * install) in the deployment that doesn't use it.
 */
export async function createDatabaseFromEnv(): Promise<Database> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for Postgres mode. " +
        "Set it in .env or as an env var (see .env.example).",
    );
  }

  if (resolveDbDriver(url) === "neon") {
    const { createNeonDatabase } = await import("./neon.js");
    return createNeonDatabase(url);
  }

  const { createSql } = await import("./connection.js");
  const { createDatabase } = await import("./drizzle.js");
  return createDatabase(createSql());
}
