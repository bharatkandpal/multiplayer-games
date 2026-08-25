# Roadmap & Delivery Plan

**Status:** Draft v0.1 · **Related:** [PRD.md](PRD.md), [TDD.md](TDD.md)

Phased so we always have something playable. Each phase ends with a demoable milestone.

> **UX bar is not a phase — it's a gate on every task.** There is no "UX polish phase" at
> the end. Every item below must meet the UX Definition of Done in
> [UX_PRINCIPLES.md](UX_PRINCIPLES.md §6) before it's considered done. The design system
> (MPG-029) is built early, in Phase 1, so every feature inherits the bar.

---

## Phase 0 — Foundations (scaffold)

**Goal:** repo, tooling, CI, shared engine skeleton.

- [x] Monorepo (pnpm workspaces): `packages/engine`, `apps/web`, `apps/server`. _(MPG-001)_
- [x] TypeScript config, lint/format, Vitest + Playwright wired. _(MPG-002)_
- [x] `GameModule` interface + `types.ts` + `registry.ts`. _(MPG-003)_
- [ ] CI: typecheck + unit tests on push.
- **Done when:** `pnpm test` runs a trivial engine test green in CI.

## Phase 1 — Local playable games + seat model (no network)

**Goal:** both games playable locally with configurable seats (human/bot) in the browser.

- [x] Tic-Tac-Toe engine + full win/draw detection + tests (N-player-generic interface). _(MPG-005)_
- [x] Connect Four engine + win detection + tests (N-player-generic interface). _(MPG-006)_
- [x] Generic minimax + alpha-beta; per-game heuristics (each module's `evaluate`); center-first ordering. _(MPG-007)_ — stateless difficulty `pickMove` is MPG-008.
- [x] Difficulty policy (Easy/Medium/Hard) + AI strength tests. _(MPG-008)_
- [ ] **Seat model** (human/bot per seat, per-seat difficulty) — POC 2 seats, no hardcoded 2.
- [ ] **Design system / UI kit first** (tokens + core components: Button, Board, Cell,
      Toast, Modal, StatusBadge, Skeleton) so every screen inherits the UX bar.
- [ ] Optimistic-UI + state-driven component helpers (loading/empty/error/success built in).
- [ ] Seat-config UI on the setup screen (assign each seat human or bot + level).
- [ ] React board components + Home/Setup/Result screens (all required states, a11y, motion).
- [ ] Play vs bot end-to-end; **mixed-level** and **bot-vs-bot watch** (paced) work locally.
- **Done when:** a player can play vs each bot level, and watch a Medium-vs-Hard bot game, for both games.

## Phase 2 — Multiplayer over a link (core v1)

**Goal:** the headline feature — share a link, play together in real time.

- [ ] Node + Socket.IO server; Room Manager; Redis (in-memory dev fallback).
- [ ] `POST /api/rooms` + invite URL; `join` flow; slot assignment.
- [ ] Server-authoritative move validation + `game:update` broadcast.
- [ ] Move AI to server-side runner (single authoritative path).
- [ ] Result + rematch flow.
- [ ] Share-link UI (copy button, join screen, room states).
- [ ] Playwright e2e: two contexts play a full game via one link.
- **Done when:** two browsers complete a PvP game through a shared link; AI mode
  works server-side; illegal/out-of-turn moves are rejected.

## Phase 3 — Robustness & polish (v1 launch)

**Goal:** production-ready launch quality.

- [ ] Disconnect/reconnect grace window + abandonment handling.
- [ ] Optional display names; friendly error/expired-room screens.
- [ ] Accessibility pass (keyboard, ARIA, contrast) + mobile responsive polish.
- [ ] Rate limiting, input validation hardening, CORS lock-down.
- [ ] Observability: structured logs, metrics, health checks.
- [ ] Deploy (frontend on CDN host, backend container + Redis, single region).
- **Done when:** v1 is deployed, meets PRD NFRs, passes e2e + a11y checks.

---

## Phase 4+ — Toward the event north-star (later versions)

The real goal: a company/HR **event platform** (100–200 people watch + play). Additive on
the seat model, not a rewrite. Sequenced roughly:

- [ ] **Teams & multi-player:** 2v2 and 3+ player game variants (more seats, team turn order).
- [ ] **Spectator seats at scale:** read-only live subscribers; shared big-screen view.
- [ ] **Event/tournament orchestration:** organizer creates an event, brackets, many rooms.
- [ ] **Accounts + persistence** (introduces Postgres): profiles, stats, leaderboards.
- [ ] **Horizontal scale:** Socket.IO Redis adapter, sticky sessions, AI worker pool.
- [ ] Turn clocks / timed modes; shareable result cards; a third game to prove extensibility.
- [ ] **(v2) Games as npm packages:** stable public plugin API so anyone can add a game via
      `npm install`. Keep the `GameModule` boundary clean now so this stays additive. (MPG-031)

## Suggested Sequencing Rationale

- Engine + AI first (Phase 1) because everything else depends on correct, tested
  rules and they're pure/fast to iterate.
- Networking second (Phase 2) — the platform's differentiator, built on a proven engine.
- Hardening last (Phase 3) once the happy paths are stable.

## Rough Sizing (relative, not calendar commitments)

| Phase                     | Relative effort |
| ------------------------- | --------------- |
| 0 Foundations             | S               |
| 1 Engines + AI + local UI | M–L             |
| 2 Multiplayer             | L               |
| 3 Robustness + launch     | M               |
