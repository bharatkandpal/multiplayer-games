/**
 * Neon serverless (HTTP) Drizzle handle — the driver the Vercel functions use.
 *
 * Unlike postgres.js (which opens and pools real TCP connections, and expects a
 * long-lived process to pool for), the Neon HTTP driver is connectionless: each
 * query is a stateless HTTPS request to Neon's edge. That is exactly the right
 * shape for a serverless function, which may be frozen or discarded between
 * invocations and can't keep a pool warm. No `.transaction()` and no relational
 * `.query` is used by any repo, so the HTTP driver's single-statement model is
 * sufficient — see `./drizzle.ts` for why the store is driver-agnostic.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import type { Database } from "./drizzle.js";
import * as schema from "./schema.js";

export function createNeonDatabase(url: string): Database {
  return drizzle(neon(url), { schema });
}
