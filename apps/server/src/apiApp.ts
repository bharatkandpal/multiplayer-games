/**
 * The stateless HTTP surface, as a reusable Express app.
 *
 * MPG-023 splits the backend in two: a long-running container that owns rooms +
 * Socket.IO (which need a persistent process), and stateless HTTP endpoints that
 * can run as serverless functions. Everything here is the latter — sessions,
 * leaderboard, results, share links, and funnel events — mounted the exact same
 * way in both deployments so the two can't drift:
 *
 *   • the container (`index.ts`) calls `createApiApp` with an `extend` hook that
 *     bolts the room routes on before the error handler, then wraps the app in an
 *     HTTP server it also attaches Socket.IO to;
 *   • the Vercel functions call `createServerlessApiApp`, which assembles the
 *     store / sink / limiter from the environment and returns the app to export.
 *
 * `createApiApp` does NOT register the built-in engine games — the two entries
 * do that once at their own module scope, so it can't happen twice here.
 */

import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

import { ENGINE_VERSION } from "@mpg/engine";

import { createEventRouter } from "./analytics/eventRoutes.js";
import { type EventSink } from "./analytics/sink.js";
import { createCardRouter } from "./cards/cardRoutes.js";
import { JSON_BODY_LIMIT } from "./config.js";
import { createIdentityRouter } from "./identity/identityRoutes.js";
import { createLeaderboardRouter } from "./leaderboard/leaderboardRoutes.js";
import { parseCorsOrigin } from "./middleware/cors.js";
import { noopLimit, type RateLimitFor } from "./middleware/rateLimit.js";
import { createReportRouter } from "./reports/reportRoutes.js";
import { createResultRouter } from "./results/resultRoutes.js";
import { createSessionMiddleware } from "./sessions/sessionMiddleware.js";
import { createSessionRouter } from "./sessions/sessionRoutes.js";
import { createShareRouter } from "./share/shareRoutes.js";
import type { Store } from "./store/ports.js";
import { createVariantRouter } from "./variants/variantRoutes.js";

export interface CreateApiAppOptions {
  store: Store;
  eventSink: EventSink;
  /** Rate-limit factory. Defaults to a no-op (limiter absent) — same as the routers. */
  limit?: RateLimitFor;
  /** `cors` origin value (see `parseCorsOrigin`). Defaults to `"*"`. */
  corsOrigin?: string | string[];
  /**
   * Hook to mount additional routes AFTER the stateless surface and BEFORE the
   * error handler. The container uses it for the room routes; the functions
   * pass nothing.
   */
  extend?: (app: Express) => void;
}

const startedAt = Date.now();

/**
 * Build the stateless API app. Assumes the engine's built-in games are already
 * registered by the caller (see file header).
 */
export function createApiApp({
  store,
  eventSink,
  limit = noopLimit,
  corsOrigin = "*",
  extend,
}: CreateApiAppOptions): Express {
  const app = express();

  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  // Session identity — mints or resolves an opaque token on every request.
  app.use(createSessionMiddleware(store));

  app.use("/api", createSessionRouter(store, limit));
  app.use("/api", createIdentityRouter(store, limit));
  app.use("/api", createLeaderboardRouter(store, eventSink, limit));
  app.use("/api", createResultRouter(store, eventSink, limit));
  app.use("/api", createShareRouter(store, eventSink, limit));
  app.use("/api", createVariantRouter(store, eventSink, limit));
  app.use("/api", createReportRouter(store, limit));
  // Public, session-free card image for unfurls (MPG-085-b) — the `og:image`
  // target ADR 0009's shim points at.
  app.use("/api", createCardRouter(store));
  app.use("/api", createEventRouter(eventSink));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", uptime: Date.now() - startedAt, engineVersion: ENGINE_VERSION });
  });
  // docs/API_SPEC.md §2 liveness alias.
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  extend?.(app);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ code: "INTERNAL_ERROR", message: "Unexpected error" });
  });

  return app;
}

/**
 * Assemble the stateless API app for a serverless deployment: build the store,
 * analytics sink, and rate limiter from the environment, then hand them to
 * {@link createApiApp}. Registers the built-in engine games first (idempotent
 * per process — a serverless instance calls this once and caches the app).
 *
 * Async because the store factory is (it may open a Neon/Postgres handle). The
 * function entry memoizes the returned promise across warm invocations.
 */
export async function createServerlessApiApp(): Promise<Express> {
  // Refuse to boot storage-less. `createStore()` falls back to the in-memory
  // adapter when DATABASE_URL is absent, which is right for the container —
  // offline play must never depend on a database (see CLAUDE.md) — but wrong
  // here: a function instance's Maps die with the instance and concurrent
  // requests hit different instances, so every write would 200 and then
  // vanish. Silent data loss is worse than a dead deployment, and a missing
  // env var must not be indistinguishable from a healthy one.
  if (!process.env["DATABASE_URL"]) {
    throw new Error(
      "DATABASE_URL is required for the serverless API — refusing to start on " +
        "the in-memory store, which cannot persist across function invocations. " +
        "Set it on the Vercel project (see apps/api/.env.example).",
    );
  }

  const { registerBuiltInGames, registerBuiltInRealtimeGames } = await import("@mpg/engine");
  const { createStore } = await import("./store/index.js");
  const { createStoreSink } = await import("./analytics/sink.js");
  const { createRateLimiter } = await import("./middleware/rateLimit.js");

  registerBuiltInGames();
  registerBuiltInRealtimeGames();

  const store = await createStore();
  const eventSink = createStoreSink(store.events);
  const rateLimiter = createRateLimiter();
  const corsOrigin = parseCorsOrigin(process.env["CORS_ORIGIN"]);

  return createApiApp({
    store,
    eventSink,
    limit: rateLimiter.limit.bind(rateLimiter),
    corsOrigin,
  });
}
