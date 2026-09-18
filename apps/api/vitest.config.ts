import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        // The handler imports `./_bundle/app.js` — generated build output that
        // is gitignored and absent on a fresh checkout (see scripts/bundle.mjs
        // for why it has to import the bundle rather than the package).
        //
        // Point that specifier back at the real source for tests, so the suite
        // needs no build step and `vi.mock("@mpg/server/app", …)` keeps working
        // exactly as it did before the bundling change. The alias is the one
        // place the indirection is undone; everything else stays honest.
        find: /^\.\/_bundle\/app\.js$/,
        replacement: fileURLToPath(new URL("../server/src/apiApp.ts", import.meta.url)),
      },
    ],
  },
});
