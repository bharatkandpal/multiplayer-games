# Multiplayer Games Platform

A web-based platform hosting a collection of small, turn-based games — playable
against an AI (minimax, three difficulties) or against another person over a
shareable link. Every seat in a game can be a human or a per-level bot, so the
same model covers play-vs-bot, play-with-a-friend, and watch-the-bots.

**Launch games:** Connect Four ("4 in a row") and Tic-Tac-Toe ("0-X").

## Status

**In development — Phase 1.** The shared game engine and AI are complete and tested;
the web design system is in place. Playable game screens are next.

- ✅ Pure shared **game engine** — Tic-Tac-Toe + Connect Four (`packages/engine`)
- ✅ **AI** — generic minimax + alpha-beta, three difficulty levels (`pickMove`)
- ✅ **Design system** — tokens + core UI primitives, light/dark, accessible (`apps/web`)
- ⏳ Game board rendering + screens (MPG-009), local play-vs-bot (MPG-010)
- ⏳ Realtime server + link-share multiplayer (`apps/server`, Phase 2)

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full plan and [tasks/](tasks/) for the
live task board.

## Getting started

**Prerequisites:** Node.js **22+**, **pnpm 11+** (`corepack enable`), and optionally
**Docker** (for local Postgres).

```bash
pnpm install                 # install all workspace dependencies
pnpm --filter @mpg/web dev   # start the web dev server → http://localhost:5173

# Optional: local Postgres for durable persistence
docker compose up -d         # Postgres 17 on localhost:5432
cp .env.example .env         # pre-filled DATABASE_URL
pnpm --filter @mpg/server db:generate   # generate migration SQL from schema
pnpm --filter @mpg/server db:migrate    # apply migrations
```

> Without Docker, the server falls back to **in-memory storage** automatically — no
> setup needed for local play or running tests.

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
| `docker compose up -d`              | Start local Postgres (optional)              |
| `pnpm --filter @mpg/server db:studio` | Open Drizzle Studio (visual DB browser)    |

New to the codebase? Start with the **[Developer Guide](docs/DEVELOPER_GUIDE.md)** — it
covers the [Quickstart](docs/DEVELOPER_GUIDE.md#quickstart), store/persistence setup,
schema, retention, and production hosting options.

## Repository layout

```
multiplayer-games/
├── packages/engine/   # @mpg/engine — pure, shared game rules + minimax AI (no I/O)
├── apps/web/          # @mpg/web — React + Vite client (design system, screens)
├── apps/server/       # @mpg/server — Node + Socket.IO backend (stub; Phase 2)
├── docs/              # PRD, TDD, architecture, game logic, UX, ADRs, this guide
└── tasks/             # file-based Kanban board (backlog / refine / active / archive)
```

## Documentation

| Doc                                                                | Purpose                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)                 | How to build, test, and work in this repo                                      |
| [docs/PRD.md](docs/PRD.md)                                         | Product requirements — what we're building and why                             |
| [docs/TDD.md](docs/TDD.md)                                         | Technical design — how we build it                                             |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                       | System architecture & data flows                                               |
| [docs/GAME_LOGIC.md](docs/GAME_LOGIC.md)                           | Game rules + minimax AI design                                                 |
| [docs/UX_PRINCIPLES.md](docs/UX_PRINCIPLES.md)                     | UX quality bar (P0 pillar) + per-task Definition of Done                       |
| [docs/API_SPEC.md](docs/API_SPEC.md)                               | REST + WebSocket contract                                                      |
| [docs/ROADMAP.md](docs/ROADMAP.md)                                 | Milestones & phased delivery                                                   |
| [docs/adr/0001-tech-stack.md](docs/adr/0001-tech-stack.md)         | ADR: core tech stack decision (TypeScript both ends)                           |
| [docs/adr/0002-realtime-games.md](docs/adr/0002-realtime-games.md) | ADR (Accepted): real-time arcade games alongside turn-based (`RealtimeModule`) |
| [docs/adr/0003-durable-persistence.md](docs/adr/0003-durable-persistence.md) | ADR (Accepted): Postgres + Drizzle durable persistence foundation             |
