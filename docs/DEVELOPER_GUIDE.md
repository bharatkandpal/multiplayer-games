# Developer Guide

How to build, test, and work in the Multiplayer Games Platform monorepo.
For product/architecture context see [PRD.md](PRD.md), [TDD.md](TDD.md), and
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## Quickstart

```bash
# 1. Install deps
pnpm install

# 2. Start BOTH servers (web :5173 + API/realtime :3001)
pnpm dev

# 3. (Optional) Start a local Postgres for durable persistence
docker compose up -d                # Postgres 17 on localhost:5432
cp .env.example .env                # DATABASE_URL pre-filled for the container
pnpm --filter @mpg/server db:generate  # generate migration SQL from schema
pnpm --filter @mpg/server db:migrate   # apply migrations

# Without Docker, the server falls back to in-memory storage automatically.
```

> **Run both servers.** `pnpm --filter @mpg/web dev` alone gives you local play
> (vs bot, watch) but **no** sessions, rooms, link-share, or leaderboards — those
> are REST/Socket.IO calls to `@mpg/server` on **:3001**. `pnpm dev` starts both.
>
> **How the client reaches the API (MPG-080).** REST calls go through `apiFetch`,
> whose base URL is `VITE_API_URL` and defaults to `""` (same-origin). In dev that
> would resolve to the Vite server on :5173, where `/api/*` doesn't exist — so
> `apps/web/vite.config.ts` **proxies `/api` → `http://localhost:3001`**. Nothing to
> configure. Override the target with `API_PROXY_TARGET` if your server runs
> elsewhere; set `VITE_API_URL` to bypass the proxy entirely (required for
> `vite preview`/production builds, which do **not** use the dev proxy).
> Socket.IO is separate — it connects straight to `VITE_SERVER_URL`
> (default `http://localhost:3001`), so it never relies on the proxy.

---

## 1. Prerequisites

- **Node.js 22+** (see `.nvmrc` → `nvm use`).
- **pnpm 11+** — pinned via the `packageManager` field in `package.json`. Run
  `corepack enable` once and pnpm will match automatically.
- **Docker** (optional) — for local Postgres. Not required for the web app or
  running tests.

```bash
pnpm install
```

## 2. Monorepo layout

pnpm workspaces (`pnpm-workspace.yaml`): `packages/*` + `apps/*`.

| Package           | Name          | Role                                                                                                                            |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine` | `@mpg/engine` | **Pure, shared** game rules + minimax AI. No I/O, no DOM, no clock, no randomness in the rules. Runs on both client and server. |
| `apps/web`        | `@mpg/web`    | React + Vite client — design system, board renderers, screens. Depends on `@mpg/engine` via `workspace:*`.                      |
| `apps/server`     | `@mpg/server` | Node + Socket.IO backend (authoritative). Persistence layer landed (Postgres + in-memory); HTTP/WS built in Phase 2.            |

The apps import the engine as a normal package (`import { ... } from "@mpg/engine"`);
pnpm symlinks it, so engine edits are picked up with no build step.

## 3. Everyday commands

Run from the repo root. `pnpm -r` fans a script out across all workspaces.

| Command                                 | What it does                                                            |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm --filter @mpg/web dev`            | Web dev server (Vite, hot reload, ~`http://localhost:5173`)             |
| `pnpm --filter @mpg/web build`          | Production build of the web app                                         |
| `pnpm build`                            | Build every workspace                                                   |
| `pnpm test`                             | Full test suite (Vitest, all packages)                                  |
| `pnpm test:fast`                        | Faster subset — excludes the heavy Connect Four AI strength simulations |
| `pnpm typecheck`                        | Strict `tsc --noEmit` across all packages                               |
| `pnpm lint` / `pnpm lint:fix`           | ESLint (flat config)                                                    |
| `pnpm format` / `pnpm format:check`     | Prettier                                                                |
| `pnpm --filter @mpg/engine test`        | Test just the engine                                                    |
| `pnpm --filter @mpg/server test`        | Test just the server (in-memory store, no DB needed)                    |
| `pnpm --filter @mpg/server db:generate` | Generate Drizzle migration SQL from schema changes                      |
| `pnpm --filter @mpg/server db:migrate`  | Apply pending migrations to your local Postgres                         |
| `pnpm --filter @mpg/server db:studio`   | Open Drizzle Studio (visual DB browser)                                 |
| `pnpm --filter @mpg/server db:smoke`    | Live round-trip against a real Postgres (needs `DATABASE_URL`) — §8     |

**What runs today:** `pnpm dev` gives you the full game catalog with local play (vs bot,
watch) **plus** the server on :3001 — sessions, room create/join over a shared link,
server-authoritative moves, rematch, and leaderboards. Running only the web dev server
still works, but limits you to local play.

## 4. Toolchain notes

- **TypeScript is pinned to the 6.x line**, not 7.0 — `typescript-eslint` does not yet
  support the TS 7 compiler API. Revisit when upstream adds support.
- **Strict TS** is on repo-wide (`tsconfig.base.json`): `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
  `noUnused*`. Consequences you'll hit:
  - Use `import type { … }` for type-only imports.
  - Array/index access is `T | undefined` — guard it.
  - Prefix intentionally-unused params with `_`.
- **Prettier owns formatting** (incl. Markdown/tables). Run `pnpm format` before committing;
  CI runs `format:check`.
- **ESM everywhere** (`"type": "module"`).

## 5. The game engine (`@mpg/engine`)

The whole platform is written against one interface, `GameModule<S, M>`, so games are
additive and nothing else needs to know a game's rules. Public surface (see
`packages/engine/src/index.ts`):

```ts
import {
  // registry
  registerBuiltInGames,
  listGames,
  getGame,
  // games
  ticTacToe,
  connectFour,
  builtInGames,
  // AI
  searchBestMove,
  pickMove,
  DIFFICULTY_TABLE,
} from "@mpg/engine";
import type { GameModule, Player, Result, Difficulty } from "@mpg/engine";
```

- **`GameModule`** — `createInitialState`, `legalMoves`, `applyMove` (pure; throws
  `IllegalMoveError`), `getResult`, `currentPlayer`, `evaluate`, optional `orderMoves`.
  N-player-generic — never hardcode 2 players.
- **Registry** — call `registerBuiltInGames()` once, then `getGame(id)` / `listGames()`.
- **AI** — `searchBestMove(game, state, { maxDepth })` is deterministic minimax +
  alpha-beta. `pickMove(game, state, difficulty, rng?)` layers the difficulty policy
  (depth + blunder rate) on top; randomness comes only from the injected `rng` (default
  `Math.random`), so seed it for reproducible tests.

Quick engine sketch (play one move vs a Hard bot):

```ts
import { ticTacToe, pickMove } from "@mpg/engine";

let state = ticTacToe.createInitialState();
const humanMove = { cell: 4 };
state = ticTacToe.applyMove(state, humanMove, ticTacToe.currentPlayer(state));
const botMove = pickMove(ticTacToe, state, "hard");
state = ticTacToe.applyMove(state, botMove, ticTacToe.currentPlayer(state));
console.log(ticTacToe.getResult(state));
```

Board conventions: Tic-Tac-Toe is a flat 9-cell array (row-major); Connect Four is
column-major `board[col][row]` with `row 0 = bottom` and gravity to the lowest empty row.

## 6. The web app (`@mpg/web`)

- **Styling: CSS Modules + CSS-variable design tokens** (see `src/styles/tokens.css`).
  No Tailwind, no CSS-in-JS, no inline styles for tokens. Theme via `data-theme` on
  `<html>` (light/dark, plus `prefers-color-scheme`); everything honors
  `prefers-reduced-motion`.
- **Primitives** live in `src/components/ui/` (Button, StatusBadge, Toast, Modal,
  Skeleton, …), exported from its `index.ts`. Build screens from these — don't roll
  one-off styles.
- **Tests:** Vitest + jsdom + React Testing Library (`src/test/setup.ts`).
- **UX is a P0 gate.** Every interactive surface must meet the Definition of Done in
  [UX_PRINCIPLES.md](UX_PRINCIPLES.md) §6 (all states, <100ms feedback, plain-language
  recoverable errors, full a11y/AA, responsive, meaningful motion, tokens-only). Run the
  `ux-review` skill / `ux-reviewer` agent before merging UI work.

## 7. The server & persistence (`@mpg/server`)

### Architecture

Postgres is the **single durable system-of-record** ([ADR 0003](adr/0003-durable-persistence.md)).
Redis stays ephemeral-only (room state, pub/sub). The engine (`packages/engine`) has
**zero I/O** — all persistence lives in `apps/server`.

### Store pattern

Four repository interfaces in `apps/server/src/store/ports.ts`, bundled as `Store`:

| Repo              | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `SessionRepo`     | Lightweight, no-PII identity tokens                           |
| `ResultRepo`      | Durable record of every completed/abandoned game              |
| `LeaderboardRepo` | Per-game standings (`score` for arcade, `wld` for turn-based) |
| `ShareLinkRepo`   | Unguessable tokens → result / replay / leaderboard view       |

Two adapters implement every port:

| Adapter                         | When                  | How                       |
| ------------------------------- | --------------------- | ------------------------- |
| **Postgres** (`store/pg/`)      | `DATABASE_URL` is set | Drizzle ORM + postgres.js |
| **In-memory** (`store/memory/`) | No `DATABASE_URL`     | Plain `Map`s; zero deps   |

Selection is automatic — if `DATABASE_URL` is present the server uses Postgres;
otherwise it falls back to in-memory (no persistence between restarts, but perfect
for dev iteration and tests).

### Local Postgres setup

```bash
docker compose up -d                          # start Postgres 17 on :5432
cp .env.example .env                          # pre-filled DATABASE_URL
pnpm --filter @mpg/server db:generate         # generate migration SQL from schema
pnpm --filter @mpg/server db:migrate          # apply migrations
```

The container stores data in a named Docker volume (`pgdata`), so it survives
`docker compose down`. To nuke everything: `docker compose down -v`.

**Don't have Docker?** Skip these steps. The server will start in in-memory mode.

### Schema & migrations

The schema is defined in TypeScript via Drizzle's `pgTable` builder
(`apps/server/src/db/schema.ts`). When you change the schema:

```bash
pnpm --filter @mpg/server db:generate   # creates a new SQL migration in drizzle/migrations/
pnpm --filter @mpg/server db:migrate    # applies it
```

Drizzle Studio (`pnpm --filter @mpg/server db:studio`) gives you a visual DB browser
for inspecting data.

### Key schema concepts

- **`owner_token`** — every row ties back to a session token via FK. "Forget me"
  cascades through this key to delete all of a user's data.
- **`run_id`** — unique idempotency key on game results. Prevents double-writes on
  retry. Leaderboard upserts reference it to avoid double-counting.
- **`event_id`** — nullable. Scopes data to a company event when present; global when
  null. Additive for the north-star event mode.
- **`metric` discriminator** — leaderboard entries carry `"score"` (arcade high score)
  or `"wld"` (turn-based win/loss/draw), with different sort orders.

### Retention & privacy

Three lifecycle operations in `apps/server/src/retention/retention.ts`:

| Function                      | What it does                                                 |
| ----------------------------- | ------------------------------------------------------------ |
| `rollingRetention(store)`     | Delete game results older than 90 days + expired share links |
| `purgeEvent(store, eventId)`  | Delete all leaderboard entries for a specific event          |
| `forgetMe(store, ownerToken)` | Delete **everything** for a session token across all repos   |

These are called programmatically today (no HTTP endpoint yet). They run against both
adapters.

### Production hosting

The code is `DATABASE_URL`-driven, so any managed Postgres works:

- **Supabase** — generous free tier, dashboard, optional auth
- **Neon** — serverless Postgres (scales to zero), branch previews
- **Railway** — simple deploy, pairs Postgres + server

Swap the connection string and you're done.

## 8. Testing conventions

- Colocate tests next to source as `*.test.ts(x)`.
- Deterministic and fast — **no `sleep`s**, seed all randomness (engine tests use a
  seeded PRNG). Test through public interfaces, not internals.
- **Server tests use the in-memory adapter by default** — no Docker or Postgres
  needed for `vitest run`. Contract tests in `store/__tests__/store.contract.test.ts`
  verify that both adapters satisfy the same interface, but **only run the
  Postgres half when `DATABASE_URL` is set** (see below).

### Verifying the Postgres path

The in-memory adapter has no foreign keys, no `NOT NULL`, and no unique-index
NULL semantics. A green `pnpm test` therefore says nothing about whether the
Postgres deployment works, and three real bugs hid behind exactly that gap until
MPG-133. Run both of these before anything that touches persistence ships:

```bash
docker compose up -d
DATABASE_URL=postgres://mpg:mpg_local@localhost:5432/mpg_dev pnpm --filter @mpg/server db:migrate

# 1. The whole server suite against Postgres. `--no-file-parallelism` is
#    required: the contract suite truncates every table, which deadlocks
#    against test files writing concurrently to the same database.
cd apps/server
DATABASE_URL=postgres://mpg:mpg_local@localhost:5432/mpg_dev \
  pnpm exec vitest run --no-file-parallelism

# 2. The live round-trip through the real production HTTP app: session →
#    result → score submission → share mint/resolve/revoke → variants →
#    identity union reads → retention sweep → forget-me.
DATABASE_URL=postgres://mpg:mpg_local@localhost:5432/mpg_dev pnpm db:smoke
```

`db:smoke` cleans up after itself (every row it writes is deleted through the
real "forget me" path) and exits non-zero on the first failed check, so it is
safe to point at staging and usable as a deploy gate.

- Engine correctness bars (enforced by tests): win/draw detection exhaustive; illegal
  moves rejected; TTT Hard never loses; C4 Hard beats random ≥95%; strength monotonic
  (Hard ≥ Medium ≥ Easy).

## 9. Git & CI workflow

- Work on a feature branch per task (e.g. `mpg-009-board`), not on `main`.
- Keep it green before merging: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`.
- **CI** (`.github/workflows/ci.yml`) runs that same sequence on push/PR (Node 22,
  pnpm 11, frozen lockfile). It executes once the repo has a GitHub remote.
- Commit messages end with the project's Co-Authored-By / session trailer (see existing
  history).

## 10. Task board

Lightweight file-based Kanban in [`tasks/`](../tasks) — `backlog.md` → `refine.md` →
`active.md` → `archive.md`, IDs prefixed `MPG-`. WIP limit 3 on Active. Large tasks are
sliced into `MPG-00X-a/-b/-c` children and the parent archived as `Sliced`.

## 11. Adding a new game

The platform is game-agnostic — a new game is a `GameModule` + a renderer, with **no
changes to the room manager, transport, or AI runner**. Follow the `add-game` skill; in
short: implement `packages/engine/src/<game>.ts`, add it to `builtInGames`, add a
heuristic/`orderMoves` if useful, write exhaustive engine tests, then build a board
renderer in `apps/web` that meets the UX bar. See
[.claude/skills/add-game/SKILL.md](../.claude/skills/add-game/SKILL.md).
