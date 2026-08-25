import { defineConfig, devices } from "@playwright/test";

// E2E config (MPG-002). Full multi-context flows land in MPG-017.
// Browser binaries are installed on first use: `pnpm exec playwright install`.
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
});
