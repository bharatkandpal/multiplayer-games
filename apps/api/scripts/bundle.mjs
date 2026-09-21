// Pre-bundles the serverless handler's TypeScript dependencies into one plain
// JS module, because Vercel's Node builder will not do it for us.
//
// THE BUG THIS EXISTS TO PREVENT (found live, 2026-09-18):
// `@vercel/node` transpiles the *entry* file only — `api/[...path].ts` becomes
// `api/[...path].js` — and leaves every import specifier inside it untouched.
// Our entry imported `@mpg/server/app`, which that package's `exports` map
// points at `./src/apiApp.ts`: raw TypeScript. Node cannot load it, so every
// single invocation died with
//     ERR_MODULE_NOT_FOUND .../@mpg/server/src/apiApp.ts
// while `vercel build` and `vercel deploy` both exited 0. Build success says
// nothing about whether the function can boot — only a real request does, which
// is why the deploy workflow now smoke-tests one.
//
// So: esbuild resolves and inlines all of our own TypeScript (`@mpg/*`) and its
// npm dependencies into `api/_bundle/app.js`, which the entry imports by
// relative path. Nothing is left to runtime module resolution except the one
// external below.
//
// Bundling npm deps rather than externalising them is deliberate: under pnpm's
// strict node_modules, `express` and friends live under `apps/server`, not
// `apps/api`, so an external import would not resolve from where the function
// actually runs.
//
// Output is ESM: `cards/raster.ts` uses `import.meta.url`, absent in CJS.

import { build } from "esbuild";

// @resvg/resvg-js ships a platform-specific `.node` binary — a bundler must not
// inline it, and Vercel installs the linux build at deploy time. It is a direct
// dependency of this package so it resolves from beside the function under
// pnpm's strict layout. Vercel's tracer follows it fine (verified: the .func
// output contains the binary).
//
// The card fonts are NOT external — see scripts/serverlessEntry.ts. Their bytes
// are embedded in the bundle, because neither tracing nor `includeFiles` ships
// them.
const EXTERNAL = ["@resvg/resvg-js"];

const result = await build({
  entryPoints: ["scripts/serverlessEntry.ts"],
  outfile: "api/_bundle/app.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: EXTERNAL,
  // Card fonts are embedded as bytes by scripts/serverlessEntry.ts. TTF only —
  // resvg cannot read woff2, which is why importing those here shipped a
  // function that rendered every card blank.
  loader: { ".ttf": "binary" },
  sourcemap: true,
  logLevel: "info",
  // Express 5 and its middleware are CJS; this keeps esbuild's interop shim from
  // tripping over `require` calls reached from ESM.
  mainFields: ["module", "main"],
  banner: {
    // Some bundled CJS dependencies call `require`, which an ESM bundle has no
    // binding for. Recreate it from this module's own URL.
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});

if (result.warnings.length > 0) {
  console.warn(`[@mpg/api] bundled with ${result.warnings.length} warning(s)`);
}
