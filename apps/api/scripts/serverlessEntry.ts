// Bundle entry for the serverless API (built by ./bundle.mjs).
//
// It exists to do one thing before re-exporting the app: hand the card renderer
// its fonts as bytes that are already inside the JavaScript.
//
// The alternative approaches were tried against a real `vercel build` and both
// produced a .func directory with zero .woff2 files in it:
//   - letting the tracer follow `require.resolve("@fontsource/…")` — it cannot,
//     that is a runtime call on a string, not a static import;
//   - `functions.includeFiles` in vercel.json — not honoured for this project
//     shape (framework: null + a prebuilt output directory).
// esbuild's `binary` loader sidesteps the question: the woff2 bytes become part
// of app.js, so there is no file for anything to fail to copy.
//
// Cost: ~32KB of base64 in the bundle. Worth it for a card route that either
// works or doesn't, with nothing in between depending on file layout.

import { setFontBuffers } from "@mpg/server/app";

import font400 from "@fontsource/nunito/files/nunito-latin-400-normal.woff2";
import font700 from "@fontsource/nunito/files/nunito-latin-700-normal.woff2";

setFontBuffers([Buffer.from(font400), Buffer.from(font700)]);

export { createApiApp, createServerlessApiApp } from "@mpg/server/app";
