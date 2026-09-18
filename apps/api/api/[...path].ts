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

// Imported from the PRE-BUNDLED build output, not from `@mpg/server/app`
// directly. Vercel's Node builder transpiles this entry file but rewrites none
// of its imports, and `@mpg/server`'s exports map points at raw `.ts` sources —
// so importing the package here deploys a function that cannot boot (it did,
// silently, until 2026-09-18). `scripts/bundle.mjs` produces this file; see its
// header for the full story.
//
// The `@mpg/server/app` types are still what this module is checked against —
// `_bundle/app.d.ts` re-exports them from source, so the seam stays type-safe
// and a signature change still breaks the build.
import { createServerlessApiApp } from "./_bundle/app.js";

// Derived from the factory so this package needn't depend on `express` directly
// (it comes transitively through @mpg/server).
type ApiApp = Awaited<ReturnType<typeof createServerlessApiApp>>;

let appPromise: Promise<ApiApp> | undefined;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  appPromise ??= createServerlessApiApp();
  const app = await appPromise;
  app(req, res);
}
