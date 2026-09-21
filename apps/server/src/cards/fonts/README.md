# Card fonts

Two vendored TTF faces, used by `../raster.ts` to rasterise share cards.

| File                   | Face           | Bytes  |
| ---------------------- | -------------- | ------ |
| `Nunito-Latin-400.ttf` | Nunito Regular | 39,332 |
| `Nunito-Latin-700.ttf` | Nunito Bold    | 39,284 |

## Why these files are checked in

`@resvg/resvg-js` 2.6.2 reads fonts **from disk, as uncompressed TTF/OTF**. It
has no woff2 decompressor and no buffer-loading option — see the long comment at
the top of `../raster.ts` for the two ways that was got wrong before, both of
which rendered a valid PNG with no text in it.

`@fontsource/nunito` ships only `.woff`/`.woff2`, so there is nothing in
`node_modules` resvg can use. Decompressing at runtime would mean a wasm woff2
decoder in the request path (and in the serverless bundle) to recover bytes that
never change. Checking in the decompressed subsets costs 78KB, adds no
dependency, and makes the card render byte-identical on every host.

## Provenance

Decompressed from `@fontsource/nunito@^5.3.0`'s latin subsets:

- `files/nunito-latin-400-normal.woff2` → `Nunito-Latin-400.ttf`
- `files/nunito-latin-700-normal.woff2` → `Nunito-Latin-700.ttf`

To regenerate (after a `@fontsource/nunito` bump, or to verify these bytes):

```sh
pnpm --filter @mpg/server fonts:regen
```

That script decompresses straight from the installed package, so its output is
reproducible from the lockfile.

## Licence

Nunito is licensed under the **SIL Open Font License 1.1**, which permits
redistribution of the fonts, modified or not, alongside this notice.
Copyright © The Nunito Project Authors (https://github.com/googlefonts/nunito).
Full text: https://openfontlicense.org
