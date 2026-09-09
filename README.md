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

**Prerequisites:** Node.js **22+** and **pnpm 11+** (this repo pins pnpm via the
`packageManager` field; `corepack enable` will pick it up automatically).

```bash
pnpm install                 # install all workspace dependencies

pnpm --filter @mpg/web dev   # start the web dev server (Vite, ~http://localhost:5173)
```

> **What you'll see today:** the web app renders the **design-system gallery**
> (buttons, toast, modal, skeleton, a light/dark theme toggle) plus the engine-backed
> games list. **Playable boards are not built yet** (MPG-009/010) — and there is **no
> server to run yet** (`apps/server` is a stub until Phase 2).

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
├── apps/server/       # @mpg/server — Node + Socket.IO backend (stub; Phase 2)
├── docs/              # PRD, TDD, architecture, game logic, UX, ADRs, this guide
└── tasks/             # file-based Kanban board (backlog / refine / active / archive)
```

## Documentation

| Doc                                                                                          | Purpose                                                                                  |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)                                           | How to build, test, and work in this repo                                                |
| [docs/PRD.md](docs/PRD.md)                                                                   | Product requirements — what we're building and why                                       |
| [docs/TDD.md](docs/TDD.md)                                                                   | Technical design — how we build it                                                       |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                                                 | System architecture & data flows                                                         |
| [docs/GAME_LOGIC.md](docs/GAME_LOGIC.md)                                                     | Game rules + minimax AI design                                                           |
| [docs/UX_PRINCIPLES.md](docs/UX_PRINCIPLES.md)                                               | UX quality bar (P0 pillar) + per-task Definition of Done                                 |
| [docs/DESIGN_LANGUAGE.md](docs/DESIGN_LANGUAGE.md)                                           | Visual direction ("Table & Cabinet") — grounds, tokens, type voices, rollout slices      |
| [docs/API_SPEC.md](docs/API_SPEC.md)                                                         | REST + WebSocket contract                                                                |
| [docs/ROADMAP.md](docs/ROADMAP.md)                                                           | Milestones & phased delivery                                                             |
| [docs/adr/0001-tech-stack.md](docs/adr/0001-tech-stack.md)                                   | ADR: core tech stack decision (TypeScript both ends)                                     |
| [docs/adr/0002-realtime-games.md](docs/adr/0002-realtime-games.md)                           | ADR (Accepted): real-time arcade games alongside turn-based (`RealtimeModule`)           |
| [docs/adr/0003-durable-persistence.md](docs/adr/0003-durable-persistence.md)                 | ADR (Accepted): durable persistence & data store (Postgres; adapter boundary)            |
| [docs/adr/0004-identity-and-social-writes.md](docs/adr/0004-identity-and-social-writes.md)   | ADR (Accepted): lightweight identity, durable sessions & social write model              |
| [docs/adr/0005-realtime-chat-and-reactions.md](docs/adr/0005-realtime-chat-and-reactions.md) | ADR (Accepted): in-game realtime chat & emoji reactions (ephemeral; fan-out; moderation) |
| [docs/adr/0006-in-game-voice-chat.md](docs/adr/0006-in-game-voice-chat.md)                   | ADR (Accepted): in-game voice chat (vendor-abstracted SFU; opt-in; audio only)           |
