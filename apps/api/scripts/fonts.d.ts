// esbuild's `binary` loader turns a .ttf import into a Uint8Array. TypeScript
// has no idea what a font file is, so declare the shape here.
//
// TTF, not woff2, and that distinction is the whole bug this once hid: resvg
// cannot read woff2 at all. See apps/server/src/cards/raster.ts.
declare module "*.ttf" {
  const bytes: Uint8Array;
  export default bytes;
}
