# Roadmap & Delivery Plan

**Status:** v1.1 — re-phased around the viral loop (2026-09-07); **reconciled against trunk
and given a current sprint (2026-09-15)**
**Related:** [PRD.md](PRD.md) · [TDD.md](TDD.md) · [ADR 0007](adr/0007-variants-and-customization.md)

Phased so we always have something playable — and now, something **shareable**.

> **UX bar is not a phase — it's a gate on every task.** There is no "UX polish phase" at
> the end. Every item below must meet the UX Definition of Done in
> [UX_PRINCIPLES.md](UX_PRINCIPLES.md) §6 before it's considered done.

> **Re-phased 2026-09-07.** Phases 0–2 are unchanged history. What was "Phase 3 —
> robustness" and "Phase 4 — event north-star" have been reorganized: the product's north
> star is now virality/creator (PRD v1.0), so the **viral loop** phases come first and event
> mode moves to the long tail. Nothing is deleted; the ordering changed.

---

## Phase 0 — Foundations (scaffold) ✅

- [x] Monorepo (pnpm workspaces): `packages/engine`, `apps/web`, `apps/server`. _(MPG-001)_
- [x] TypeScript config, lint/format, Vitest + Playwright wired. _(MPG-002)_
- [x] `GameModule` interface + `types.ts` + `registry.ts`. _(MPG-003)_
- [x] CI: typecheck + unit tests on push. _(MPG-004)_

## Phase 1 — Local playable games + seat model ✅

- [x] Tic-Tac-Toe and Connect Four engines + win/draw detection, N-player-generic. _(MPG-005/006)_
- [x] Generic minimax + alpha-beta; per-game heuristics; difficulty policy. _(MPG-007/008)_
- [x] Seat model — human/bot per seat, per-seat difficulty. _(MPG-009/024)_
- [x] Design system / UI kit first, so every screen inherits the UX bar. _(MPG-029)_
- [x] Optimistic-UI + state-driven component helpers. _(MPG-030)_
- [x] Home / Setup / Play / Result screens; play vs bot, mixed levels, bot-vs-bot watch. _(MPG-009/010)_

## Phase 2 — Multiplayer over a link + the real-time family ✅

> **The integration debt this section used to warn about is discharged.** The 2026-09-07 note
> here (server stack stranded on `feat/mpg-055-leaderboard`, `apps/server/src` a 7-line stub,
> trunk local-play-only) was true when written and is now **stale** — MPG-084 landed the whole
> stack, and everything below is on `main`. Left recorded rather than deleted because it is the
> clearest example the project has of the board drifting from the trunk: it distorted the front
> of the queue for three days. Check claims against `main`, not against this file.

- [x] **Real-time game family** — `RealtimeModule` (ADR 0002); Floppy Birds, Drunk Walk.
- [x] Turn-based catalog: Tic-Tac-Toe, Move-Mode TTT, Connect Four, Nim, Gomoku.
- [x] Node + Socket.IO server; Room Manager; Redis with in-memory dev fallback.
- [x] `POST /api/rooms` + invite URL; join flow; slot assignment. _(MPG-016)_
- [x] Server-authoritative move validation + `game:update`; server-side AI runner.
- [x] Result + rematch flow; share-link UI.
- [x] Creator-watch join for all-bot rooms. _(MPG-025)_
- [x] Server-side score re-simulation (anti-cheat foundation). _(MPG-065)_
- [x] Session tokens (identity substrate). _(MPG-054)_
- [x] Playwright e2e: two contexts play a full game via one link.

**Catalog on `main` (10):** Tic-Tac-Toe, Move-Mode Tic-Tac-Toe, Connect Four, Nim, Gomoku
(turn-based) · Floppy Birds, Drunk Walk, Breakout, 2048, Reflex Test (real-time).

---

## Phase 3 — Close the loop ✅ **(the loop is closed; the tail is in the current sprint)**

**Goal:** a player can discover a game, play it, make it theirs, and post the result — and
that post brings someone else in. This is the whole product thesis; nothing after it matters
if this doesn't work.

> **Status 2026-09-15: all five legs are live end to end.** A player lands on a shelved Home,
> plays one of ten games, recolours it, saves it as a named variant, gets a server-validated
> score with a rank, and shares a durable link that unfurls as a rendered card — with a
> claimable handle carrying ownership across devices. **The backlog's P0 column is empty for
> the first time.** What is left below is the tail (checked items are on `main`), and it is
> what the current sprint picks up.

### 3z. **Land the trunk first** ✅

- [x] Merge the Phase 2 server stack into `main`. _(MPG-084)_
- [x] Merge Gomoku and the other stranded feature branches.
- [x] Give `apps/server` a real `dev` script.
- [x] Fix the dev-env REST wiring so `apiFetch` calls reach the server. _(MPG-080)_

### 3a. Share — _leg 5_ ✅ _(one verification owed)_

- [x] Durable share links: result / leaderboard / variant, outliving the room. _(MPG-056, MPG-089-b)_
- [x] **Share/result card image** — spoiler-free, brag-first; per-game registry, deterministic
      SVG → PNG, immutably cached. _(FR-23 — MPG-085-a/b)_
- [x] **OG/Twitter metadata** on every shareable route, via the ADR 0009 head-only unfurl
      shim. _(FR-24 — MPG-086)_
- [x] One-tap share (Web Share API + desktop fallback), mobile-first.
- [ ] **Verify the unfurl on real platforms** — owed since 2026-09-12; **blocked on a live
      deploy**, so it is Track B's exit criterion this sprint, not a codeable task.
- [ ] **Score context** on the card — personal best / percentile. _(FR-30 — MPG-095)_
- **Done when:** finishing a run produces a card a player would actually post, and pasting
  the link into a social platform unfurls correctly.

### 3b. Win — _leg 4_ ✅

- [x] Leaderboards, server-validated only. _(MPG-055)_
- [x] Every real-time game's score submission runs through re-simulation. _(FR-27 — MPG-093)_

### 3c. Customize — _leg 3, L1 of the ladder_ ✅ _(one proof owed)_

- [x] **Generic cosmetic layer**: per-game cosmetic schema + fixed palettes. _(FR-20 — MPG-088-a)_
- [x] **Variant object** — named, owned, persisted, moderated. _(FR-21 — MPG-089-a/b)_
- [x] **Variant share links** — anyone opens and plays, no signup. _(FR-22 — MPG-089-c)_
- [ ] Cosmetics for at least one turn-based game, proving the layer is generic, + automated
      AA-contrast validation of every palette. _(MPG-088-c — Ready; deferred by this sprint)_

### 3d. Discover — _leg 1_ ✅ _(Trending still dark)_

- [x] Home restructured into Featured / Trending / New. _(FR-25 — MPG-090 + MPG-111)_
- [ ] **Trending ranking function** — the shelf is wired but omitted entirely until a real
      ranking exists, which is the honest cold-start behaviour. _(FR-36 — MPG-094)_
- [ ] Time-to-first-input from a cold shared link < 3 s on mid-range mobile — **measurable now**
      (`first_input` ships), **unmeasured until deployed**.

### 3e. Identity — _the substrate under 3a–3d_ ✅

- [x] **Claimable handle** — device-key + recovery code, no passwords. _(FR-26 — MPG-091-a/b/c)_
- [x] Claim prompt fires only after a win or a leaderboard-worthy score — never before the
      first game.
- [x] **Text moderation** on handles and variant names, + report-a-name. _(FR-34 — MPG-092)_

### 3f. Robustness — _the open tail_

- [x] Rate limiting, input validation, CORS lock-down. _(MPG-021)_
- [ ] Accessibility pass + mobile responsive polish. _(MPG-020 — **sprint, Track A**)_
- [ ] Observability: structured logs, metrics, health checks. _(MPG-022 — **sprint, Track B**)_
- [ ] Deploy: frontend on CDN host, backend container + Redis + Postgres. _(MPG-023 — **sprint,
      Track B**)_
- [ ] Disconnect/reconnect grace + abandonment; convert a seat to a bot. _(MPG-018)_
- [ ] Friendly expired-room + bad-invite screens — **rescoped down**: the durable share link
      already ships a full dead/expired state machine, so what remains is the lower-traffic
      live-room path. _(MPG-019)_

---

## Current sprint — UI-led, deployment in parallel _(started 2026-09-15)_

**`tasks/sprint.md` is the authority**; this is the phase-altitude summary.

With the loop closed and P0 empty, the sprint is not about new legs. It is the two things
between "it works locally" and "a stranger can use it":

- **Track A — UI: make it one product.** `MPG-116 → MPG-117` (tier-2 tokens, then a shared
  `BoardGrid` so five boards stop each picking their own radius and gap), `MPG-112` (tag
  filter on Home), `MPG-113` (the seat rail, which currently exists three times and is why
  turn affordances drift between local / online / watch). Then, past the cut line:
  `MPG-115` (one result card across post-game and shared-link views) and `MPG-020` (a11y +
  mobile, scheduled last because it touches every screen and ten shipped rows have deferred
  their real-browser pass into it).
- **Track B — deployment: get it running somewhere real.** `MPG-133` (exercise the Postgres
  path live — every verification to date ran on the in-memory fallback), `MPG-135` (the
  `apps/api` serverless workspace still reports "No test files found"), `MPG-022`
  (observability, **before** the deploy, not after), `MPG-023` (the deploy itself).

They run in parallel because they barely share files — Track A is `apps/web`, Track B is
`apps/server` / `apps/api` / infra.

**Held out on purpose, with reasons in `tasks/sprint.md`:** the rest of the design-language
run (`MPG-114`, `MPG-118 → MPG-119`, `MPG-066`) — `MPG-119` needs the "detox the current art
or re-art it" call against `MPG-079` before either starts; and `MPG-057` (chat) + `MPG-088-c`
(turn-based cosmetics), both Ready but neither UI-system nor deploy work.

---

## Phase 4 — Compound the catalog (L2 + creators)

**Goal:** remixing makes the catalog grow faster than we can build games.

- [ ] **Per-game `ParamSchema`** — declared, bounded knobs, validated client + server. _(FR-28)_
- [ ] L2 rule-parameter UI, live preview before committing.
- [ ] **Variant-scoped leaderboards** keyed by parameter hash; base board canonical. _(FR-29)_
- [ ] **Fork a variant**, lineage preserved. _(FR-31)_
- [ ] **"Plays of your creation"** stats feeding Trending. _(FR-32)_
- [ ] AI retuning where parameters move a game outside its heuristic's tuned range.
- **Done when:** a meaningful share of plays are of player-made variants, not base games.

## Phase 5 — Creator tooling (streamers & short-form)

- [ ] **Clean/spectator view** — chrome-free, OBS-usable. _(FR-33)_
- [ ] Thumbnail legibility pass — readable small and in a 9:16 crop.
- [ ] **Replay view** from the deterministic input log, shareable. _(FR-35)_
- [ ] **Clip export** — video/GIF of the last N seconds. _(FR-37)_
- [ ] **Creator pages** — a handle's variants and stats. _(FR-40)_
- [ ] Chat / reactions overlay, if the audience wants it. _(MPG-057 family)_

## Phase 6 — L3 asset UGC (gated)

**Blocked until the moderation pipeline exists.** Not a scheduling choice — a hard gate.

- [ ] **Moderation pipeline**: automated screening (hash-match + explicit/hate classifiers),
      human escalation, IP takedown + appeal, private-by-default. _(FR-39)_
- [ ] Asset storage + CDN + per-slot upload constraints.
- [ ] **Asset upload into cosmetic slots** — renderer-only, same as L1. _(FR-38)_
- **Done when:** a player can upload art, and we can take it down.

## Phase 7+ — Long tail

- [ ] **Arena mode** — many players running the same solo game at once + live aggregate
      spectator view. _(MPG-078)_ — strong creator/event overlap.
- [ ] **Voice** overlay for rooms. _(MPG-061…064)_
- [ ] **Horizontal scale** — Socket.IO Redis adapter, sticky sessions, AI worker pool. _(MPG-067)_
- [ ] **Teams & multi-player variants** (2v2, 3+). _(MPG-026)_
- [ ] **Spectator seats at scale** + shared big-screen view. _(MPG-027)_
- [ ] **Event / tournament orchestration** — the secondary use case (PRD §12). _(MPG-028)_
- [ ] **(v2) Games as npm packages** — stable public plugin API. _(MPG-031)_

## Sequencing rationale

- **Share before customize.** Sharing is the highest-leverage leg and mostly rides work
  already in flight (MPG-055/056). Customization without sharing is a settings screen.
- **L1 before L2 before L3**, per ADR 0007 — ascending cost and risk, descending leverage.
- **Robustness rides alongside Phase 3, not after it.** A dead shared link kills the loop, so
  error screens and rate limiting are now loop-critical rather than launch hygiene.
- **New games are no longer the default way to grow the catalog** — variants are. Add games
  for _variety of mechanic_, not for count, and only at the quality bar.

## Rough sizing (relative, not calendar commitments)

| Phase                        | Relative effort |
| ---------------------------- | --------------- |
| 0–2 (done)                   | —               |
| 3 Close the loop (done)      | —               |
| Current sprint (UI + deploy) | M–L             |
| 4 Compound the catalog (L2)  | M–L             |
| 5 Creator tooling            | M               |
| 6 L3 asset UGC (gated)       | L               |
| 7+ Long tail                 | XL              |
