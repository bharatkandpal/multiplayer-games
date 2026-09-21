# Ably notify spike (ADR 0010 amendment)

Throwaway spike proving the **Ably notify hop** for serverless turn-based multiplayer.
Silo'd outside the pnpm workspace, **no npm dependencies** (Ably is hit over its REST API
with `fetch`; the browser loads the SDK from Ably's CDN). Do not import this into the app.

## What it validates

1. **Ping-then-fetch** — the move endpoint bumps a version and fire-and-forget publishes only
   `{ v }`; the opponent's browser wakes on the push and GETs the authoritative version. The
   payload is never trusted as state.
2. **Token-capability auth** — the server mints an Ably token scoped to exactly `room:<id>`
   (subscribe-only). The "Auth scoping check" button proves a wrong-room token is refused, and
   clients have no publish capability (only the server pushes → authority stays server-side).
3. **Latency** — measures push latency (serverTs→receive), the re-fetch cost, and end-to-end
   (opponent's move click → my re-render), to check against the UX latency budget.

## Run

1. Get an Ably API key (free account → app → API key, format `appId.keyId:secret`).
2. Write it to `spikes/ably-notify/.env.local` (gitignored):

   ```
   ABLY_API_KEY=appId.keyId:secret
   ```

3. From `spikes/ably-notify/`:

   ```
   node --env-file=.env.local server.mjs
   ```

4. Open http://localhost:8787, click **Connect both players**, then **Make move** on one panel
   and watch the other update via push. Run the **scoping check** to confirm authorization.

## What it deliberately does NOT do

- No Neon / RoomRepo — an in-memory `Map` stands in for the version row.
- No real move validation, seats, or bots — the version is the only state.
- Not deployed to Vercel — the move/token handlers are plain HTTP so the round-trip is
  observable locally; porting them to `apps/api` is mechanical (Express routes + `@vercel/node`).
