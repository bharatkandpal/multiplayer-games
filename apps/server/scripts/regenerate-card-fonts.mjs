// Regenerates the vendored card fonts in src/cards/fonts/.
//
// resvg 2.6.2 needs uncompressed TTF on disk; @fontsource ships only woff2.
// Rather than carry a wasm woff2 decoder into the request path (and into the
// serverless bundle) to recover bytes that never change, we decompress once,
// here, and check the result in. See src/cards/fonts/README.md.
//
// Run after bumping @fontsource/nunito:  pnpm --filter @mpg/server fonts:regen

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { decompress } from "wawoff2";

const require = createRequire(import.meta.url);
const OUT_DIR = fileURLToPath(new URL("../src/cards/fonts/", import.meta.url));

const FACES = [
  ["nunito-latin-400-normal.woff2", "Nunito-Latin-400.ttf"],
  ["nunito-latin-700-normal.woff2", "Nunito-Latin-700.ttf"],
];

for (const [source, target] of FACES) {
  const woff2 = readFileSync(require.resolve(`@fontsource/nunito/files/${source}`));
  const ttf = Buffer.from(await decompress(woff2));

  // A TTF starts with the sfnt version tag 0x00010000 (or "OTTO" for CFF
  // outlines). If this is wrong the card silently renders with no text, so it
  // is worth failing loudly right here instead.
  const magic = ttf.subarray(0, 4).toString("hex");
  if (magic !== "00010000" && ttf.subarray(0, 4).toString("ascii") !== "OTTO") {
    throw new Error(`${target}: decompressed to something that is not a TTF (magic ${magic})`);
  }

  writeFileSync(new URL(target, `file://${OUT_DIR}`), ttf);
  console.log(`${target}  ${ttf.length} bytes`);
}
