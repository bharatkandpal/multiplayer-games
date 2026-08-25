# End-to-end tests (Playwright)

Full flows land in **MPG-017** (two-context PvP over a shared link, vs-bot, bot-vs-bot watch),
covering the UX states in `docs/UX_PRINCIPLES.md`.

Config: `../playwright.config.ts`. Before the first run, install browsers:

```bash
pnpm exec playwright install
pnpm exec playwright test
```
