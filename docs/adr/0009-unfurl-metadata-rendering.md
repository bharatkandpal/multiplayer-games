# ADR 0009 — Serving unfurl metadata for shareable routes

**Status:** Proposed (2026-09-11)
**Date:** 2026-09-11
**Deciders:** Bharat (lead)
**Decision lens:** Get real `og:*`/`twitter:*` tags in front of social scrapers without
turning a client-only SPA into a server-rendered app, and without breaking offline play.
**Builds on:** ADR 0003 (durable persistence / share links), and the shipped share-link
layer (MPG-056) + card renderer (MPG-085-a).
**Note on numbering:** 0007 is reserved for the variants / `ParamSchema` decision cited
across `tasks/backlog.md`; 0008 is vision input. This ADR takes 0009.

---

## Context

The whole point of the loop's share leg is that a link pasted into iMessage, Slack, Discord,
X, or Facebook renders a rich card — a title, a description, and the game's result image —
instead of a bare URL. That "unfurl" is produced by social scrapers that fetch the URL and
read `<meta og:* / twitter:*>` **out of the initial HTML response**. They do not run
JavaScript.

Our client is a pure Vite SPA. `apps/web/index.html` is a static shell with one generic
`<title>Multiplayer Games</title>` and no OG tags at all; every screen — including the share
screen — is rendered client-side after the bundle boots (`createRoot` in `main.tsx`, route
parsed from `window.location.pathname` in `App.tsx`). Confirmed against trunk:
`git grep 'og:image\|twitter:card' -- apps` returns **nothing**.

So a scraper hitting a share link today gets the generic shell and produces a generic (or
empty) unfurl. **This cannot be fixed on the client** — the code that would set the tags runs
in a JS engine the scraper doesn't have. Something server-side has to put the right tags in
the HTML for those specific paths. That "something" is the decision.

Three facts from the trunk shape the answer:

1. **The resolve data already exists, publicly and session-free.** `GET /api/share/:token`
   (`apps/server/src/share/shareRoutes.ts`) requires no session by design and returns exactly
   what an unfurl needs: `{ kind, result }` for `result`/`replay`, and
   `{ kind: "leaderboard", gameId, eventId }` for a leaderboard link. Nothing new has to be
   built to *know* what a token points at.

2. **The `og:image` is already a deterministic server asset.** The card renderer lives in
   `apps/server/src/cards/` (MPG-085-a: `renderResultCard(result) → SVG`, pure and
   byte-deterministic across all eight games), and MPG-085-b exposes it as
   `GET /api/cards/:token.png` with immutable caching. The unfurl's image URL is therefore
   just that endpoint — the metadata layer never renders an image itself.

3. **Production is a split, not one origin.** The backend does **not** serve the SPA build
   (`git grep express.static\|sendFile -- apps/server` → nothing), and the monorepo boundary
   says only the frontend is distributable. MPG-023 puts the static frontend on a CDN host and
   the Express backend in a container. So the host that actually receives a request for
   `https://…/s/:token` is the **frontend CDN host**, not the game backend.

Two pillars constrain any answer:

- **Offline play is inviolable / graceful degradation.** Unfurls are an enhancement on the
  share leg. If the metadata path is down or a token doesn't resolve, a human who clicks the
  link must still land in a working app; the scraper simply gets the generic shell. No share
  route may become a hard dependency on this layer being up.
- **Keep the SPA a SPA.** The interactive app is client-rendered and works well that way.
  Whatever we add must serve *scrapers* their `<head>` and *humans* the same SPA they get
  today — it must not fork the app into a second, server-rendered rendering path we then have
  to keep in sync.

The scope is small and enumerable. The public share-entry URLs are `/s/:token` today, with
`kind ∈ { result, replay, leaderboard }`, and a future `variant` kind (MPG-089). Room links
(`/:gameId/room/:roomId`) are ephemeral, private, and explicitly **not** unfurl targets.

## Decision

**Serve a head-only "unfurl shim" for the shareable route prefixes, co-located with the
frontend host, that injects real `<meta>` into the SPA's own HTML shell at request time.**

Concretely:

- The frontend host runs a small function (edge/serverless) mapped by a **path rewrite** to
  the share prefixes only — `/s/*` today, plus the future `variant` prefix. Every other path
  is served as the static SPA exactly as now.
- For a matched request the shim:
  1. calls the already-public `GET /api/share/:token` on the backend to learn `{ kind, … }`;
  2. builds the `<meta og:* / twitter:*>` set from that record — title/description from the
     game + result (reusing the same title/label source the card renderer uses, e.g.
     `apps/server/src/cards/titles.ts`), and `og:image` = the absolute
     `…/api/cards/:token.png` URL from fact 2;
  3. returns the SPA's **own** `index.html`, unchanged except that the built `<head>` has the
     computed tags injected. Because it is the same shell — same hashed `main.*.js`/CSS asset
     tags emitted by the Vite build the shim is deployed alongside — a human who clicks the
     link boots the identical SPA and the client router takes over at `/s/:token`. A scraper
     reads the `<head>` and stops.
- **Degradation is the default branch, not an add-on.** If the backend resolve call fails,
  times out, or 404s, the shim serves the untouched static `index.html` (generic tags). The
  human still gets the app; the scraper gets a plain unfurl. Nothing 5xxs, nothing blocks.

This is deliberately **not** React SSR: we render only the `<head>`, from a tiny data object,
with no React on the server, no hydration, no `renderToString`, no double render path to keep
in sync. It is the smallest thing that puts correct tags in front of a scraper.

**Why co-located at the frontend host rather than a route on the game backend.** The share URL
already lands at the frontend host, so the shim needs no cross-origin CDN→backend rewrite, and
— critically — it has the built `index.html` (with the correct hashed asset filenames) sitting
right next to it to inject into. A shim living on the Express backend instead would force the
CDN to proxy `/s/*` to another origin *and* would need a copy of, or hardcoded knowledge of,
the frontend's hashed asset names — coupling the backend to the frontend build across the
one-way import boundary. Co-location avoids both. The shim still reads the backend only through
its existing public API, so no share/data logic moves off the backend.

**Dependency this imposes on MPG-023 (deploy):** the chosen frontend host must be able to run a
function with a path rewrite (Vercel / Netlify / Cloudflare Pages all do). This is a
requirement on that task, recorded here. See *Fallback* below for the static-only case.

## Options considered

### (a) Full SSR / prerender of the share routes — rejected

Server-render the actual React app (or prerender share pages at build/mint time) so the real
screen HTML, meta included, ships in the first response.

Rejected: it is the largest possible answer to a `<head>`-only problem. It introduces
server-side React, a hydration path, and a build/runtime split we would have to keep in sync
forever — for a scraper that reads six tags and never looks at the body. Prerendering at mint
time additionally fights durable, revocable, unbounded-in-number share tokens (a page per token,
invalidated on revoke/expiry). The value (correct unfurl) is fully captured by rendering the
head alone; the rest is cost with no reader.

### (b) Meta-shim as a route on the Express game backend — rejected (kept as fallback)

Put the shim on `apps/server` and have the CDN proxy `/s/*` to it.

Rejected as the primary: it needs a cross-origin CDN→backend rewrite, and to return a bootable
SPA shell it needs the frontend's hashed asset filenames — either a shipped copy of the built
`index.html` or hardcoded paths — which couples the backend to the frontend build and violates
the "only the frontend is distributable" boundary. It is, however, the correct **fallback** if
MPG-023 lands on a static-only frontend host with no function support: then the shim runs on the
backend, the CDN proxies the share prefixes to it, and the backend is given the build's
`index.html` as a deploy artifact. Same head-only design either way — only where it runs moves.

### (c) Standalone edge function that owns share rendering — rejected as framed

Move share routes wholesale to an independent edge function that renders the unfurl (and
possibly the resolve) at the edge.

Rejected *as a separate owner of share logic*: the resolve logic and data already live on the
backend behind a public endpoint, and the card image is already a backend asset. A function that
re-implements resolution splits that logic and adds a hop; a function that just calls the
existing endpoint is exactly the chosen shim. The decision keeps the edge/serverless function as
a **thin `<head>` injector over the existing public API**, not as a second home for share logic.

## Consequences

**Positive**
- MPG-086 becomes Ready: it implements this shim, then verifies against the real scrapers
  (FB debugger, X card validator, Slack, Discord, iMessage) rather than by reading local HTML.
- The SPA stays a SPA. No hydration, no server React, one rendering path for humans.
- No new data path: the shim reads `GET /api/share/:token` and points at
  `GET /api/cards/:token.png` — both already built or already scoped (MPG-085-b).
- Offline/degradation pillar is satisfied structurally: the failure branch *is* today's static
  shell, so a dead metadata layer degrades to absence, never to a broken share route.
- `og:image:alt`: the SVG card carries a `<title>` but a PNG cannot, so the shim owns
  `og:image:alt` / `twitter:image:alt` text — resolving the open item flagged in MPG-085-b.

**Negative / watch-outs**
- Adds a function to the frontend deployment, and thus a hard requirement on MPG-023's host
  choice (or the fallback shape above). This ADR is a blocker on that decision, by design.
- The shim duplicates the *title/description phrasing* the card renderer already encodes. Share
  the source (`cards/titles.ts` and the game catalog labels) rather than re-authoring copy, so
  the unfurl text and the card image can never drift.
- One security note carried from the write-path work (MPG-021): the shim takes a `:token` from
  the URL and calls the backend with it — it must pass it as an opaque parameter to the existing
  resolve endpoint (which already validates and is rate-limited), never interpolate it into the
  returned HTML. Injected tag *values* come from the resolved record's known fields and must be
  HTML-attribute-escaped.

**Scope**
- Applies to `/s/:token` with `kind ∈ { result, replay, leaderboard }` now, and the future
  `variant` kind (MPG-089) via the same prefix mechanism. Room links are out of scope
  (ephemeral, private, not unfurl targets).
