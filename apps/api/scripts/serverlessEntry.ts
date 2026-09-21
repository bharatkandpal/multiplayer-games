// Bundle entry for the serverless API (built by ./bundle.mjs).
//
// It exists to do one thing before re-exporting the app: hand the card renderer
// its fonts as bytes that are already inside the JavaScript.
//
// Vercel will not ship the font files any other way. Both alternatives were
// tried against a real `vercel build` and both produced a .func directory with
// zero font files in it:
//   - letting the tracer follow the renderer's path resolution — it cannot,
//     that is a runtime call, not a static import;
//   - `functions.includeFiles` in vercel.json — not honoured for this project
//     shape (framework: null + a prebuilt output directory).
// esbuild's `binary` loader sidesteps the question: the bytes become part of
// app.js, so there is no file for anything to fail to copy.
//
// THE FORMAT MATTERS. These are uncompressed **TTF**, not the `.woff2` this
// file used to import. resvg 2.6.2 cannot decompress woff2, and it has no
// option to take a font as a buffer at all — so the previous version of this
// file shipped 32KB of unusable bytes into a `fontBuffers` key resvg ignores,
// and every card rendered blank in production while returning a valid 200 PNG.
// `setCardFontBuffers` writes these to a temp file, which is the only thing
// resvg will actually read. See apps/server/src/cards/raster.ts.
//
// Cost: ~105KB of base64 in the bundle. Worth it for a card route that either
// works or doesn't, with nothing in between depending on file layout.

import { setCardFontBuffers } from "@mpg/server/app";

import font400 from "@mpg/server/cards/fonts/Nunito-Latin-400.ttf";
import font700 from "@mpg/server/cards/fonts/Nunito-Latin-700.ttf";

setCardFontBuffers([font400, font700]);

export { createApiApp, createServerlessApiApp } from "@mpg/server/app";
