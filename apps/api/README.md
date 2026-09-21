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
rasterises the share card with `@resvg/resvg-js` and a Nunito face — serverless
has no system fonts, so the font must ship. Vercel installs the linux resvg
binary and traces it correctly; the **font files it does not trace**, because
`cards/raster.ts` reaches them through a runtime path resolution that no static
analyser can follow. `functions.includeFiles` does not rescue them either (tried,
verified against a local `vercel build`: zero font files in the `.func` output).

So the bytes are embedded in the JavaScript instead — `scripts/serverlessEntry.ts`
imports the two faces through esbuild's `binary` loader and injects them via
`setCardFontBuffers`, which writes them to `/tmp` once per cold start and hands
resvg the paths. ~105KB of base64, in exchange for a route that cannot fail on
file layout.

**The faces are uncompressed TTF, and that is load-bearing.** resvg 2.6.2 reads
fonts only from disk and only as TTF/OTF: it cannot decompress woff2, and it has
no option to accept a font as a buffer. This package shipped woff2 into a
`fontBuffers` key that does not exist for a month, and every card rendered blank
behind a valid 200 PNG the whole time. `apps/server/src/cards/fonts/` holds the
decompressed subsets and explains how to regenerate them; the regression is
pinned by `apps/server/src/cards/__tests__/raster.test.ts`, which counts ink
pixels because status codes cannot see this class of failure.

Both deployments talk to the **same Neon database** — that is by design: the
socket move-handler on the container persists results to the same store the
share/leaderboard functions read.

## How it's wired

- `api/[...path].ts` is a single catch-all function. It delegates every request
  to the one Express app from `@mpg/server/app` (`createServerlessApiApp`),
  built lazily and memoized across warm invocations.
- **It imports that app from `api/_bundle/app.js`, not from the package.** Vercel
  transpiles the entry file but rewrites none of its import specifiers, and
  `@mpg/server`'s `exports` map points at raw `.ts` sources — so importing the
  package directly deploys a function that cannot boot. It did exactly that, on
  every request, from the day this workspace shipped until 2026-09-18, with green
  deploys throughout. `scripts/bundle.mjs` (run as this package's `build`)
  pre-bundles the whole app into plain JS; read its header before changing any of
  this.
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
4. **Verify with a request, not with a green build.** `.github/workflows/deploy.yml`
   now smokes `GET /api/leaderboard?gameId=connect-four` after every deploy and
   fails the job on anything but a 200. Keep that gate: the entire class of bug
   this package has already hit is invisible to the build.
5. **Frontend**: set `VITE_API_URL` to this deployment's origin so the SPA's
   `apiFetch` targets it. Identity travels in the `x-session-token` header, so no
   cross-site-cookie configuration is required.

## Local dev

The container (`pnpm --filter @mpg/server dev`) already serves the identical
endpoints on `:3001`; the Vite dev proxy points there. Use that for day-to-day
work. `vercel dev` (from `apps/api`) exercises the function packaging itself.
