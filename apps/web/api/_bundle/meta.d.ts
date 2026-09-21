// Types for the generated `meta.js` bundle (see ../../scripts/bundle-api.mjs).
// The bundle itself is gitignored build output; this declaration points back at
// the real source so the function stays checked against it.
//
// The `.js` extension is REQUIRED, not decorative. Vercel compiles this function
// with `moduleResolution: nodenext`, where an extensionless relative import does
// not resolve at all — so this whole module came back empty and every symbol
// `unfurl.ts` imports from it reported "has no exported member" on every
// production build. It was cosmetic only by luck: esbuild transpiles regardless
// of the type errors, so the function shipped working while its type seam —
// the one thing standing between us and another ERR_MODULE_NOT_FOUND — had
// silently stopped checking anything.
//
// `tsconfig.api.json` now uses nodenext too, so `pnpm typecheck` sees what
// Vercel sees instead of resolving this leniently and reporting success.
export * from "../../src/unfurl/meta.js";
