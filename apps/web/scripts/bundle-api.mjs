// Pre-bundles the unfurl function's TypeScript imports into plain JS.
//
// Same failure as `apps/api/scripts/bundle.mjs` — see that file for the full
// story. In short: Vercel's Node builder transpiles `api/unfurl.ts` to
// `api/unfurl.js` but rewrites none of its import specifiers, so the deployed
// function kept asking for `../src/unfurl/meta` — extensionless, and TypeScript
// besides. Node cannot resolve either, so every `/s/:token` request 500'd with
//     ERR_MODULE_NOT_FOUND .../apps/web/src/unfurl/meta
// from the day it shipped, while the SPA beside it served fine.
//
// That is a quiet failure worth naming: ADR 0009 designed this function to
// degrade to the untouched shell on ANY error, and it does — but only for errors
// it gets to catch. A module that never loads runs none of its own fallbacks, so
// the one path that was supposed to be unbreakable returned a bare 500 instead.
// Bundling removes the runtime resolution that made that possible.
//
// `src/unfurl/meta.ts` is pure and dependency-free, so everything inlines and
// there are no externals to declare.

import { build } from "esbuild";

await build({
  entryPoints: ["src/unfurl/meta.ts"],
  outfile: "api/_bundle/meta.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
});
