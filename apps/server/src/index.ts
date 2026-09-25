// @mpg/server — local dev entry for the stateless HTTP surface.
// MPG-023: this app is assembled once by `createApiApp` and shared verbatim
// with the Vercel serverless functions (`apps/api`) — that's production;
// this file just binds it to a port for local development.
// Online play no longer needs a long-running process: two browsers exchange
// moves directly over Ably (see src/game/gameTokenRoutes.ts), so there is no
// room manager and no Socket.IO here anymore.

import { createServer } from "node:http";

import { ENGINE_VERSION, registerBuiltInGames, registerBuiltInRealtimeGames } from "@mpg/engine";

import { createStoreSink } from "./analytics/sink.js";
import { createApiApp } from "./apiApp.js";
import { parseCorsOrigin } from "./middleware/cors.js";
import { createRateLimiter } from "./middleware/rateLimit.js";
import { createStore } from "./store/index.js";

registerBuiltInGames();
registerBuiltInRealtimeGames();

const store = await createStore();
const mode = process.env["DATABASE_URL"] ? "postgres" : "memory";

console.log(`@mpg/server — engine v${ENGINE_VERSION}, store: ${mode}`);

// CORS lock-down (MPG-021, docs/TDD.md §11). `CORS_ORIGIN` is a comma-separated
// allowlist of app origins; unset defaults to `*` for dev convenience. In
// production a wildcard is almost certainly a misconfiguration, so we warn
// loudly on startup rather than shipping an open API silently — but we don't
// hard-crash, because the origin allowlist is an operator concern.
const corsOrigin = parseCorsOrigin(process.env["CORS_ORIGIN"]);
if (process.env["NODE_ENV"] === "production" && corsOrigin === "*") {
  console.warn(
    "[cors] CORS_ORIGIN is unset in production — the API is accepting requests from ANY " +
      "origin. Set CORS_ORIGIN to your app origin(s) to lock this down.",
  );
}

// In-house rate limiter (MPG-021). Disabled (no-op) unless RATE_LIMITER_URL is
// set, and fail-open when the service is unreachable — see middleware/rateLimit.ts.
const rateLimiter = createRateLimiter();
console.log(`@mpg/server — rate limiter: ${rateLimiter.enabled ? "enabled" : "disabled"}`);
const limit = rateLimiter.limit.bind(rateLimiter);

// Loop analytics (MPG-097). Behind the `EventSink` seam, so swapping in a
// hosted vendor later is a change here and nowhere else. The sink never throws:
// instrumentation is not allowed to break the thing it measures.
const eventSink = createStoreSink(store.events);

const app = createApiApp({ store, eventSink, limit, corsOrigin });

const httpServer = createServer(app);

const port = Number(process.env["PORT"] ?? 3001);

// Only bind a real port when run directly (`node src/index.ts` / `pnpm dev`), not
// when imported by tests — tests exercise `app` in-process instead.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  httpServer.listen(port, () => {
    console.log(`@mpg/server listening on :${port}`);
  });
}

export { app, httpServer, store };
