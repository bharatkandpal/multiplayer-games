# Multiplayer Games Platform

**A place where a small set of great games become infinitely many, because players
remix them and share the results.**

A curated catalog of short, instantly-playable browser games — turn-based ones you play
against a bot or a friend over a link, and solo real-time arcade ones you play for a
score. The product thesis is the loop: **discover → play → customize → win → share**, and
back around as someone else's shared result becomes the next player's first session.

Every seat in a turn-based game can be a human or a per-level bot, so one model covers
play-vs-bot, play-with-a-friend, and watch-the-bots.

**Catalog on `main`:** Tic-Tac-Toe, Move-Mode Tic-Tac-Toe, Connect Four, Nim (turn-based)
· Floppy Birds, Drunk Walk (solo real-time). Gomoku is on an unmerged branch.

## Status

**In development — Phase 3: closing the viral loop.**

> ⚠️ **Trunk state (verified 2026-09-07):** `main` is **local-play only**. The whole
> multiplayer server stack — Socket.IO, Room Manager, leaderboards, session tokens,
> re-simulation anti-cheat — is built and tested but lives on the unmerged
> `feat/mpg-055-leaderboard` branch; `apps/server/src/` on `main` is a 7-line stub.
> Landing that branch is the top priority (MPG-084) and blocks the rest of Phase 3.

- ✅ Pure shared **game engine** + registry — turn-based `GameModule` and real-time
  `RealtimeModule` families (`packages/engine`)
- ✅ **AI** — generic minimax + alpha-beta, three difficulty levels (`pickMove`)
- ✅ **Design system** — tokens + core UI primitives, light/dark, accessible (`apps/web`)
- ✅ **Local play** — vs bot at three levels, mixed levels, all-bot watch; both game families
- 🔨 **On a branch, pending merge** — Socket.IO server + Room Manager, link-share
  multiplayer, leaderboards, session tokens, server-side score re-simulation (anti-cheat)
- ⏳ **Share cards** (spoiler-free, OG-unfurling), **Variants** (customization you can
  name and share), **Featured / Trending / New** discovery, claimable handles

The product direction was rewritten on 2026-09-07 — see [docs/PRD.md](docs/PRD.md) for the
viral loop and [ADR 0007](docs/adr/0007-variants-and-customization.md) for how
customization works without breaking server authority.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full plan and [tasks/](tasks/) for the
live task board.

## Getting started

**Prerequisites:** Node.js **22+** and **pnpm 11+** (this repo pins pnpm via the
`packageManager` field; `corepack enable` will pick it up automatically).

```bash
pnpm install                 # install all workspace dependencies

pnpm --filter @mpg/web dev   # start the web dev server (Vite, ~http://localhost:5173)
```

> **What you'll see today:** the games home screen, with every game in the catalog
> playable — vs a bot at three levels, or in all-bot watch mode. The design-system gallery
> is still reachable from home. **Link-share multiplayer and leaderboards are not available
> on `main`** (see Status above); `pnpm --filter @mpg/server dev` currently just prints a
> placeholder.

### Common commands (run from the repo root)

| Command                             | What it does                                 |
| ----------------------------------- | -------------------------------------------- |
| `pnpm install`                      | Install all workspace deps                   |
| `pnpm --filter @mpg/web dev`        | Web dev server (hot reload)                  |
| `pnpm --filter @mpg/web build`      | Production build of the web app              |
| `pnpm build`                        | Build every workspace                        |
| `pnpm test`                         | Full test suite (all packages)               |
| `pnpm test:fast`                    | Faster subset (skips heavy AI strength sims) |
| `pnpm typecheck`                    | Strict TypeScript check across the repo      |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                       |
| `pnpm format` / `pnpm format:check` | Prettier                                     |

New to the codebase? Start with the **[Developer Guide](docs/DEVELOPER_GUIDE.md)**.

## Repository layout

```
multiplayer-games/
├── packages/engine/   # @mpg/engine — pure, shared game rules + minimax AI (no I/O)
├── apps/web/          # @mpg/web — React + Vite client (design system, screens)
├── apps/server/       # @mpg/server — Node + Socket.IO backend (stub on main; built on a branch)
├── docs/              # PRD, TDD, architecture, game logic, UX, ADRs, this guide
└── tasks/             # file-based Kanban board (backlog / refine / active / archive)
```

## Documentation

| Doc                                                                                        | Purpose                                                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)                                         | How to build, test, and work in this repo                                                      |
| [docs/PRD.md](docs/PRD.md)                                                                 | Product requirements — what we're building and why                                             |
| [docs/TDD.md](docs/TDD.md)                                                                 | Technical design — how we build it                                                             |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                                               | System architecture & data flows                                                               |
| [docs/GAME_LOGIC.md](docs/GAME_LOGIC.md)                                                   | Game rules + minimax AI design                                                                 |
| [docs/UX_PRINCIPLES.md](docs/UX_PRINCIPLES.md)                                             | UX quality bar (P0 pillar) + per-task Definition of Done                                       |
| [docs/API_SPEC.md](docs/API_SPEC.md)                                                       | REST + WebSocket contract                                                                      |
| [docs/ROADMAP.md](docs/ROADMAP.md)                                                         | Milestones & phased delivery                                                                   |
| [docs/adr/0001-tech-stack.md](docs/adr/0001-tech-stack.md)                                 | ADR: core tech stack decision (TypeScript both ends)                                           |
| [docs/adr/0002-realtime-games.md](docs/adr/0002-realtime-games.md)                         | ADR (Accepted): real-time arcade games alongside turn-based (`RealtimeModule`)                 |
| [docs/adr/0007-variants-and-customization.md](docs/adr/0007-variants-and-customization.md) | ADR (Accepted): Variants — the customization/UGC ladder (L1 cosmetics → L2 params → L3 assets) |
