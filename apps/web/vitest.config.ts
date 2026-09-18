import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        // `api/unfurl.ts` imports `./_bundle/meta.js` — generated build output
        // that is gitignored and therefore absent on a fresh checkout (see
        // scripts/bundle-api.mjs for why it cannot import the source directly).
        //
        // Point that specifier back at the real source for tests, so the suite
        // needs no build step. Without this the unfurl handler tests pass
        // locally (where a build has run) and fail in CI — which is exactly how
        // this was found.
        find: /^\.\/_bundle\/meta\.js$/,
        replacement: fileURLToPath(new URL("./src/unfurl/meta.ts", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
