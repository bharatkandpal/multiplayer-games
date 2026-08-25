# Developer Guide

How to build, test, and work in the Multiplayer Games Platform monorepo.
For product/architecture context see [PRD.md](PRD.md), [TDD.md](TDD.md), and
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Prerequisites

- **Node.js 22+** (see `.nvmrc` → `nvm use`).
- **pnpm 11+** — pinned via the `packageManager` field in `package.json`. Run
  `corepack enable` once and pnpm will match automatically.

```bash
pnpm install
```

## 2. Monorepo layout

pnpm workspaces (`pnpm-workspace.yaml`): `packages/*` + `apps/*`.

| Package           | Name          | Role                                                                                                                            |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine` | `@mpg/engine` | **Pure, shared** game rules + minimax AI. No I/O, no DOM, no clock, no randomness in the rules. Runs on both client and server. |
| `apps/web`        | `@mpg/web`    | React + Vite client — design system, board renderers, screens. Depends on `@mpg/engine` via `workspace:*`.                      |
| `apps/server`     | `@mpg/server` | Node + Socket.IO backend (authoritative). **Stub today** — built in Phase 2.                                                    |

The apps import the engine as a normal package (`import { ... } from "@mpg/engine"`);
pnpm symlinks it, so engine edits are picked up with no build step.

## 3. Everyday commands

Run from the repo root. `pnpm -r` fans a script out across all workspaces.

| Command                             | What it does                                                            |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `pnpm --filter @mpg/web dev`        | Web dev server (Vite, hot reload, ~`http://localhost:5173`)             |
| `pnpm --filter @mpg/web build`      | Production build of the web app                                         |
| `pnpm build`                        | Build every workspace                                                   |
| `pnpm test`                         | Full test suite (Vitest, all packages)                                  |
| `pnpm test:fast`                    | Faster subset — excludes the heavy Connect Four AI strength simulations |
| `pnpm typecheck`                    | Strict `tsc --noEmit` across all packages                               |
| `pnpm lint` / `pnpm lint:fix`       | ESLint (flat config)                                                    |
| `pnpm format` / `pnpm format:check` | Prettier                                                                |
| `pnpm --filter @mpg/engine test`    | Test just the engine                                                    |

**What runs today:** `pnpm --filter @mpg/web dev` shows the design-system gallery +
engine-backed games list. Boards/screens are MPG-009; there is no server yet.

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

## 7. Testing conventions

- Colocate tests next to source as `*.test.ts(x)`.
- Deterministic and fast — **no `sleep`s**, seed all randomness (engine tests use a
  seeded PRNG). Test through public interfaces, not internals.
- Engine correctness bars (enforced by tests): win/draw detection exhaustive; illegal
  moves rejected; TTT Hard never loses; C4 Hard beats random ≥95%; strength monotonic
  (Hard ≥ Medium ≥ Easy).

## 8. Git & CI workflow

- Work on a feature branch per task (e.g. `mpg-009-board`), not on `main`.
- Keep it green before merging: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`.
- **CI** (`.github/workflows/ci.yml`) runs that same sequence on push/PR (Node 22,
  pnpm 11, frozen lockfile). It executes once the repo has a GitHub remote.
- Commit messages end with the project's Co-Authored-By / session trailer (see existing
  history).

## 9. Task board

Lightweight file-based Kanban in [`tasks/`](../tasks) — `backlog.md` → `refine.md` →
`active.md` → `archive.md`, IDs prefixed `MPG-`. WIP limit 3 on Active. Large tasks are
sliced into `MPG-00X-a/-b/-c` children and the parent archived as `Sliced`.

## 10. Adding a new game

The platform is game-agnostic — a new game is a `GameModule` + a renderer, with **no
changes to the room manager, transport, or AI runner**. Follow the `add-game` skill; in
short: implement `packages/engine/src/<game>.ts`, add it to `builtInGames`, add a
heuristic/`orderMoves` if useful, write exhaustive engine tests, then build a board
renderer in `apps/web` that meets the UX bar. See
[.claude/skills/add-game/SKILL.md](../.claude/skills/add-game/SKILL.md).
