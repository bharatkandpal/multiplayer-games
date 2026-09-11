# Roadmap & Delivery Plan

**Status:** Draft v1.0 — **re-phased around the viral loop (2026-09-07)**
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

## Phase 2 — Multiplayer over a link + the real-time family ⚠️ built, **not merged**

> **Integration debt — read this before planning anything.** Verified on `main`,
> 2026-09-07: `apps/server/src/` contains **only a 7-line stub**, and `git grep` for
> `socket.io` / `RoomManager` across `main` returns **nothing**. All of the Phase 2 server
> work below exists **only on `feat/mpg-055-leaderboard`** (rooms, socket handlers, bot
> runner, leaderboard routes, Drizzle schema, retention — with tests), which is 4 ahead /
> 5 behind `main`. Gomoku sits on its own branch too. **The trunk today is local-play
> only.** Landing this is the single largest blocker on the roadmap — see MPG-084.

- [x] **Real-time game family** — `RealtimeModule` (ADR 0002); Floppy Birds, Drunk Walk. _(on `main`)_
- [x] Turn-based catalog: Tic-Tac-Toe, Move-Mode TTT, Connect Four, Nim. _(on `main`)_
- [~] Node + Socket.IO server; Room Manager; Redis with in-memory dev fallback. _(branch only)_
- [~] `POST /api/rooms` + invite URL; join flow; slot assignment. _(MPG-016 — branch only)_
- [~] Server-authoritative move validation + `game:update`; server-side AI runner. _(branch only)_
- [~] Result + rematch flow; share-link UI. _(branch only)_
- [~] Creator-watch join for all-bot rooms. _(MPG-025 — branch only)_
- [~] Server-side score re-simulation (anti-cheat foundation). _(MPG-065 — branch only)_
- [~] Session tokens (identity substrate). _(MPG-054 — branch only)_
- [~] Gomoku. _(`feat/game-gomoku` — branch only)_
- [~] Playwright e2e: two contexts play a full game via one link. _(branch only)_

**Catalog on `main`:** Tic-Tac-Toe, Move-Mode Tic-Tac-Toe, Connect Four, Nim (turn-based)
· Floppy Birds, Drunk Walk (solo real-time). Gomoku pending merge.

---

## Phase 3 — Close the loop (the current phase)

**Goal:** a player can discover a game, play it, make it theirs, and post the result — and
that post brings someone else in. This is the whole product thesis; nothing after it matters
if this doesn't work.

### 3z. **Land the trunk first** — _blocks everything below_

- [ ] Merge the Phase 2 server stack (`feat/mpg-055-leaderboard`) into `main`, rebased on
      the 5 commits it's behind. _(MPG-084)_
- [ ] Merge Gomoku (`feat/game-gomoku`) and any other stranded feature branches.
- [ ] Give `apps/server` a real `dev` script — it currently echoes
      `"dev server configured in MPG-011"`.
- [ ] Fix the dev-env REST wiring so `apiFetch` calls reach the server. _(MPG-080)_
- **Done when:** `main` can run a link-share PvP game and submit a validated score, from a
  clean clone, with one documented command.

### 3a. Share — _leg 5, highest leverage, do first_

- [ ] Durable share links: result / replay / leaderboard, outliving the room. _(MPG-056)_
- [ ] **Share/result card image** — spoiler-free, brag-first, minimal branding. _(FR-23)_
- [ ] **OG/Twitter metadata** on every shareable route; verify unfurl on real platforms. _(FR-24)_
- [ ] One-tap share (Web Share API + desktop fallback), mobile-first.
- [ ] **Score context** on the card — personal best / percentile. _(FR-30)_
- **Done when:** finishing a run produces a card a player would actually post, and pasting
  the link into a social platform unfurls correctly.

### 3b. Win — _leg 4, the thing worth sharing_

- [ ] Leaderboards, server-validated only. _(MPG-055, in flight)_
- [ ] Wire every real-time game's score submission through re-simulation. _(FR-27)_
- **Done when:** 100% of board scores are server-validated, and a score is legible enough
  to brag about.

### 3c. Customize — _leg 3, L1 of the ladder_

- [ ] **Generic cosmetic layer**: per-game cosmetic schema + fixed, AA-validated palettes;
      generalized from Drunk Walk's character system. _(FR-20)_
- [ ] **Variant object** — named, owned, persisted (base game + cosmetics). _(FR-21)_
- [ ] **Variant share links** — anyone opens and plays, no signup. _(FR-22)_
- [ ] Cosmetics for at least one turn-based game, proving the layer is generic.
- **Done when:** a player saves a named variant and a friend plays it from a link.

### 3d. Discover — _leg 1_

- [ ] Home screen restructured into **Featured / Trending / New**. _(FR-25)_
- [ ] Curated Featured (carries the cold start); Trending appears only with real signal. _(FR-36)_
- [ ] Time-to-first-input from a cold shared link < 3 s on mid-range mobile.
- **Done when:** the home screen signals what's worth playing right now, and a shared link
  lands the visitor in the shared thing with an obvious "play this."

### 3e. Identity — _the substrate under 3a–3d_

- [ ] **Claimable handle** — upgrade a session token to a durable owner; no passwords. _(FR-26)_
- [ ] Claim prompt appears _after_ the player has something worth keeping — never before the
      first game.
- [ ] **Text moderation** on handles and variant names. _(FR-34)_
- **Done when:** variants, scores, and share links have a durable owner across devices.

### 3f. Robustness (retained from the old Phase 3 — required for public traffic)

- [ ] Disconnect/reconnect grace + abandonment; option to convert a seat to a bot. _(MPG-018)_
- [ ] Friendly error / expired-room / dead-link screens — **a broken shared link is a broken
      viral loop**, so this matters more now than it did. _(MPG-019)_
- [ ] Accessibility pass + mobile responsive polish. _(MPG-020)_
- [ ] Dev-env REST wiring fix (`/api` proxy / `VITE_API_URL`). _(MPG-080)_
- [ ] Observability: structured logs, metrics, health checks. _(MPG-022)_
- [ ] Rate limiting, input validation, CORS lock-down — **now genuinely needed**, since public
      sharing means real traffic and anonymous writes. _(MPG-021)_
- [ ] Deploy: frontend on CDN host, backend container + Redis. _(MPG-023)_

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

| Phase                       | Relative effort |
| --------------------------- | --------------- |
| 0–2 (done)                  | —               |
| 3 Close the loop            | L               |
| 4 Compound the catalog (L2) | M–L             |
| 5 Creator tooling           | M               |
| 6 L3 asset UGC (gated)      | L               |
| 7+ Long tail                | XL              |
