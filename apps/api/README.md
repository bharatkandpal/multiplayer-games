# @mpg/api — serverless HTTP API

The **stateless** half of the backend (MPG-023), deployed as Vercel functions and
backed by Neon Postgres. It reuses `@mpg/server`'s router/store code verbatim —
there is no forked handler logic here.

## What runs where

| Surface                                                                     | Deployment                         | Why                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `sessions`, `leaderboard`, `results`, `share`, `events`, `cards/:token.png` | **here** (Vercel functions + Neon) | stateless request/response; no persistent process needed               |
| rooms (`/api/rooms`) + Socket.IO realtime                                   | `@mpg/server` container            | need a long-running process holding the `RoomManager` and live sockets |

`GET /api/cards/:token.png` is the unfurl image (ADR 0009's `og:image` target). It
rasterises the share card with `@resvg/resvg-js` and a **bundled** Nunito face
(`@fontsource/nunito`) — serverless has no system fonts, so the font must ship.
Both are dependencies of `@mpg/server`; Vercel installs the linux resvg binary and
its file-tracing includes the woff2 assets (resolved via `require.resolve`). If a
deploy ever renders blank-text cards, confirm the `.node` binary and the woff2
files made it into the function bundle.

Both deployments talk to the **same Neon database** — that is by design: the
socket move-handler on the container persists results to the same store the
share/leaderboard functions read.

## How it's wired

- `api/[...path].ts` is a single catch-all function. It delegates every request
  to the one Express app from `@mpg/server/app` (`createServerlessApiApp`),
  built lazily and memoized across warm invocations.
- The store picks its driver from the environment (`apps/server/src/db/index.ts`):
  a `*.neon.tech` `DATABASE_URL` (or `DB_DRIVER=neon`) uses the connectionless
  Neon serverless HTTP driver — the right shape for functions that can't keep a
  connection pool warm. The container keeps using postgres.js.

## Why there is an empty `public/`

This project has no static output — it is functions only. But `framework: null`
means Vercel still looks for a static output directory once the build command
runs, and fails the deploy with `No Output Directory named "public" found`. The
empty `public/` (kept by `.gitkeep`, declared via `outputDirectory`) satisfies
that check. Deleting it breaks the deploy; it serves nothing.

## Deploy

1. **Neon**: create a database; copy the **pooled** connection string
   (host contains `-pooler`).
2. **Migrate** (run once from the repo, against the Neon URL):
   ```sh
   DATABASE_URL='postgres://…-pooler.…neon.tech/…?sslmode=require' \
     pnpm --filter @mpg/server db:migrate
   ```
3. **Vercel project**: point Root Directory at `apps/api`. Set the env vars from
   `.env.example` (`DATABASE_URL`, `CORS_ORIGIN`, optionally `RATE_LIMITER_URL`).
4. **Frontend**: set `VITE_API_URL` to this deployment's origin so the SPA's
   `apiFetch` targets it. Identity travels in the `x-session-token` header, so no
   cross-site-cookie configuration is required.

## Local dev

The container (`pnpm --filter @mpg/server dev`) already serves the identical
endpoints on `:3001`; the Vite dev proxy points there. Use that for day-to-day
work. `vercel dev` (from `apps/api`) exercises the function packaging itself.
