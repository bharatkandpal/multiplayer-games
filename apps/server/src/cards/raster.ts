/**
 * SVG → PNG rasterisation for share cards (MPG-085-b).
 *
 * `cards/index.ts` renders a byte-deterministic SVG; scrapers, however, do not
 * render SVG, so the `og:image` must be a PNG. This module is the one place that
 * turns the former into the latter, with `@resvg/resvg-js` (a pure SVG→PNG
 * rasteriser — no headless browser, no layout engine of its own).
 *
 * ## The font, solved here — and the two ways it was solved wrong first
 *
 * The card SVG uses system font stacks (`DESIGN_LANGUAGE` §3: no webfont), and a
 * server — least of all a serverless function — has none of those faces
 * installed. We bundle **Nunito** (the rounded face already named in the display
 * stack, OFL-1.1) and point resvg at it with system-font loading OFF, so the
 * raster is deterministic across every host rather than dependent on whatever
 * the OS happens to have.
 *
 * Getting the faces *into* resvg took three attempts. Both failures rendered a
 * perfectly valid 1200×630 PNG with **every glyph missing** — a 200 response
 * carrying a blank card, which no status-code check can catch:
 *
 *  1. `fontFiles` pointing at `@fontsource`'s **.woff2** — resvg 2.6.2 does not
 *     decompress woff2; it loads the file, finds no usable face, and draws no
 *     text. (Verified on Linux: byte-identical output to passing no fonts.)
 *  2. `fontBuffers` with the woff2 bytes embedded in the bundle — **there is no
 *     such option.** resvg-js 2.6.2 accepts `fontFiles` and `fontDirs` only; an
 *     unknown key is ignored in silence. It looked plausible because the options
 *     object was cast (`as unknown as ResvgOptions`), which switched off the one
 *     check that would have said so. That cast is gone, deliberately — the
 *     options below are type-checked against resvg's own declarations now.
 *
 * What actually works, and is what ships: **uncompressed TTF, referenced by
 * path.** `./fonts/*.ttf` are the decompressed latin subsets (78KB the pair, see
 * that directory's README for provenance and how to regenerate them). The
 * container reads them from source; the serverless bundle cannot (Vercel's
 * tracer follows neither `require.resolve` nor `new URL(import.meta.url)`, and
 * `includeFiles` did not ship them either) so it embeds the bytes in the
 * JavaScript and calls `setCardFontBuffers`, which materialises them to a temp
 * file once per cold start. Either way resvg is handed a real path to a real TTF.
 *
 * Regression cover lives in `__tests__/raster.test.ts`: it asserts the rendered
 * PNG actually contains dark text pixels, because "200 with an image body" is
 * exactly what both broken versions returned.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

import { CARD_WIDTH, renderResultCard, type ResultCardInput } from "./index.js";

/**
 * The two faces, in the order the serverless bundle embeds them (regular, bold).
 * Names are shared with `./fonts/` and with `apps/api/scripts/serverlessEntry.ts`.
 */
const FONT_FILENAMES = ["Nunito-Latin-400.ttf", "Nunito-Latin-700.ttf"] as const;

/**
 * Resolved paths to the TTF faces. Lazy, and deliberately so: this used to be
 * eager module-scope work, which meant a font that failed to resolve threw while
 * the module graph was still loading — taking down the ENTIRE API, every
 * endpoint, over an asset only the card renderer needs. Deferring keeps that
 * failure inside the one route that depends on it, where `cardRoutes` degrades
 * to a 404 like any other missing card (ADR 0009 / the offline pillar).
 */
let fontPaths: string[] | undefined;

/**
 * Supply the faces as **uncompressed TTF bytes**, for deployments that cannot
 * ship the files themselves.
 *
 * The serverless bundle uses this: `apps/api` embeds the TTFs at build time
 * (esbuild's `binary` loader) and injects them here, because Vercel's file
 * tracer cannot follow the runtime path resolution the container relies on, and
 * `includeFiles` did not ship them either (both verified against a real
 * `vercel build` — the .func output contained zero font files).
 *
 * resvg only reads fonts from disk, so the bytes are written to a private temp
 * directory once and the paths handed over. On Vercel that is `/tmp`, writable
 * and instance-local; ~78KB per cold start, never per request.
 *
 * The container ignores this and reads `./fonts/` directly.
 */
export function setCardFontBuffers(buffers: readonly Uint8Array[]): void {
  const dir = mkdtempSync(join(tmpdir(), "mpg-card-fonts-"));
  fontPaths = buffers.map((bytes, i) => {
    const path = join(dir, FONT_FILENAMES[i] ?? `face-${i}.ttf`);
    writeFileSync(path, bytes);
    return path;
  });
}

/** The container / local-dev path: the TTFs sit next to this module in source. */
function sourceFontPaths(): string[] {
  const dir = fileURLToPath(new URL("./fonts/", import.meta.url));
  return FONT_FILENAMES.map((name) => join(dir, name));
}

function getFontPaths(): string[] {
  fontPaths ??= sourceFontPaths();
  return fontPaths;
}

/**
 * Rasterise a result's card to a PNG buffer at the card's natural 1200×630 — the
 * size social scrapers expect for `og:image`. Deterministic: same result in,
 * same bytes out (the whole reason the caller can cache it immutably).
 */
export function renderResultCardPng(result: ResultCardInput): Buffer {
  return Buffer.from(renderCard(result).asPng());
}

/**
 * The raw RGBA image behind {@link renderResultCardPng}.
 *
 * Exported for `__tests__/raster.test.ts`, which has to inspect pixels: the only
 * way to tell a working card from the blank one this module shipped twice is to
 * look for glyph ink, and a PNG buffer's length won't say. Sharing the render
 * keeps the test honest — it exercises the same font configuration production
 * does, rather than a copy that could drift into passing on its own.
 */
export function renderResultCardImage(result: ResultCardInput): {
  pixels: Buffer;
  width: number;
  height: number;
} {
  const { pixels, width, height } = renderCard(result);
  return { pixels, width, height };
}

function renderCard(result: ResultCardInput) {
  const svg = renderResultCard(result);
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: getFontPaths(),
      // OFF on purpose: the card must rasterise identically on a developer's
      // Mac (fonts everywhere) and on a Vercel function (none at all). Leaving
      // it on is also what hid failure #1 above for weeks — macOS quietly
      // substituted a system face locally while production drew nothing.
      loadSystemFonts: false,
      defaultFontFamily: "Nunito",
    },
    fitTo: { mode: "width", value: CARD_WIDTH },
  });
  return resvg.render();
}
