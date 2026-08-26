# TODO

## CI / Deploy

- [ ] **Add Vercel deploy secrets** (GitHub → Settings → Secrets and variables → Actions).
      The `.github/workflows/deploy.yml` job fails at `vercel pull` until these exist:
  - `VERCEL_TOKEN` — https://vercel.com/account/tokens
  - `VERCEL_ORG_ID` — from `.vercel/project.json` after `npx vercel link`
  - `VERCEL_PROJECT_ID` — from `.vercel/project.json` after `npx vercel link`
- [ ] Confirm the Vercel project **Root Directory** is `apps/web` (where `vercel.json` lives).
- [ ] After secrets are in, re-run the deploy job on PR #1 to verify the preview deploy + PR comment.
