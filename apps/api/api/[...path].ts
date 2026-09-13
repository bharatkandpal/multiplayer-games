/**
 * Catch-all Vercel function for the stateless HTTP API (MPG-023).
 *
 * Every `/api/*` request the frontend host routes here is handed to the ONE
 * Express app built by `@mpg/server`'s `createServerlessApiApp` — the same app,
 * mounted the same way, as the long-running container. This is the single
 * catch-all packaging decision: one function, maximum reuse, no per-route
 * re-wiring of middleware.
 *
 * The app is assembled lazily and memoized across warm invocations: building it
 * opens the Neon handle and registers the engine games, which we do once per
 * cold instance, not per request. The promise (not the resolved app) is cached
 * so concurrent first requests share a single build instead of racing.
 *
 * Rooms + Socket.IO are deliberately NOT here — they need a persistent process
 * and live on the @mpg/server container.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createServerlessApiApp } from "@mpg/server/app";

// Derived from the factory so this package needn't depend on `express` directly
// (it comes transitively through @mpg/server).
type ApiApp = Awaited<ReturnType<typeof createServerlessApiApp>>;

let appPromise: Promise<ApiApp> | undefined;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  appPromise ??= createServerlessApiApp();
  const app = await appPromise;
  app(req, res);
}
