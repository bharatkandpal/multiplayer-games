// esbuild's `binary` loader turns a .woff2 import into a Uint8Array. TypeScript
// has no idea what a font file is, so declare the shape here.
declare module "*.woff2" {
  const bytes: Uint8Array;
  export default bytes;
}
