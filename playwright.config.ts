import { defineConfig, devices } from "@playwright/test";

// E2E config (MPG-002/MPG-017): full multi-context flows (two browser
// contexts sharing an invite link, vs-bot, bot-vs-bot watch) live in `./e2e`.
// Browser binaries are installed on first use: `pnpm exec playwright install chromium`.
//
// `webServer` boots BOTH the real-time server (:3001, in-memory store — no
// `DATABASE_URL` is set here) and the Vite dev server (:5173) so the suite
// exercises the actual client/server contract, not a mock. `reuseExistingServer`
// (non-CI only) lets a dev already running `pnpm dev` skip the double-boot.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @mpg/server dev",
      url: "http://localhost:3001/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { CORS_ORIGIN: "*" },
    },
    {
      command: "pnpm --filter @mpg/web dev -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
