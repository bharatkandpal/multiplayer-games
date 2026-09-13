/**
 * SVG → PNG rasterisation for share cards (MPG-085-b).
 *
 * `cards/index.ts` renders a byte-deterministic SVG; scrapers, however, do not
 * render SVG, so the `og:image` must be a PNG. This module is the one place that
 * turns the former into the latter, with `@resvg/resvg-js` (a pure SVG→PNG
 * rasteriser — no headless browser, no layout engine of its own).
 *
 * ## The font, solved here
 *
 * The card SVG uses system font stacks (`DESIGN_LANGUAGE` §3: no webfont), and a
 * server — least of all a serverless function — has none of those faces
 * installed, so `cards/svg.ts` flagged the missing font binary as this slice's
 * problem to solve. We solve it by bundling **Nunito** (already the rounded face
 * named in the display stack, OFL-licensed, shipped as data by `@fontsource`) and
 * pointing resvg at it with system-font loading OFF — so the raster is
 * deterministic across every host, not dependent on whatever the OS happens to
 * have. The mono voice (tabular scores) has no bundled match and falls through to
 * Nunito via `defaultFontFamily`; Nunito's digits read cleanly, which is an
 * acceptable v1 trade rather than shipping a second face.
 *
 * The font buffers are read once at module load and reused for every render.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { Resvg } from "@resvg/resvg-js";

import { CARD_WIDTH, renderResultCard, type ResultCardInput } from "./index.js";

const require = createRequire(import.meta.url);

// Read as buffers (not `fontFiles` paths): resvg-js@2.6.2 loads woff2 only via
// `fontBuffers` — `fontFiles` silently renders no text for a woff2. Static
// specifiers keep the assets in the serverless bundle's file trace.
const FONT_BUFFERS: Buffer[] = [
  readFileSync(require.resolve("@fontsource/nunito/files/nunito-latin-400-normal.woff2")),
  readFileSync(require.resolve("@fontsource/nunito/files/nunito-latin-700-normal.woff2")),
];

type ResvgOptions = ConstructorParameters<typeof Resvg>[1];

/**
 * Rasterise a result's card to a PNG buffer at the card's natural 1200×630 — the
 * size social scrapers expect for `og:image`. Deterministic: same result in,
 * same bytes out (the whole reason the caller can cache it immutably).
 */
export function renderResultCardPng(result: ResultCardInput): Buffer {
  const svg = renderResultCard(result);
  // `fontBuffers` is honored at runtime (verified: it renders the woff2 text)
  // but is absent from 2.6.2's type declarations, so the options object is cast
  // once here rather than reaching for a global type override.
  const options = {
    font: {
      fontBuffers: FONT_BUFFERS,
      loadSystemFonts: false,
      defaultFontFamily: "Nunito",
    },
    fitTo: { mode: "width", value: CARD_WIDTH },
  } as unknown as ResvgOptions;
  const resvg = new Resvg(svg, options);
  return Buffer.from(resvg.render().asPng());
}
