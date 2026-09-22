# CLAUDE.md

Project guidance for Claude Code.

## Before calling any change done

Run **`pnpm verify`** (typecheck + lint + format:check + full test) and fix every failure
before reporting work as complete or opening a PR.

Do not substitute the test suite for this. Vitest alone does not typecheck, and this
repo's web tsconfig includes tests — so a change can pass `vitest` and still fail `tsc`.

**Verification is local, not CI** (2026-09-22). Git hooks run it:

- **pre-commit** — prettier + eslint on staged files only (~2s).
- **pre-push** — `pnpm verify:fast` (~30s): the full gate, but `test:fast`.
- Hooks install via the `prepare` script on `pnpm install`.

Two consequences to respect rather than work around:

- **Never pass `--no-verify`.** It skips the only gate this repo has left. If a hook
  fails, fix the cause; don't bypass it.
- **`pnpm verify:fast` is not sufficient before a PR.** `test:fast` excludes
  `packages/engine/src/ai/difficulty.test.ts` (a ~45s minimax sweep), so a green push
  says nothing about it. Run the full `pnpm verify`, or dispatch the manual `Verify`
  workflow (`gh workflow run ci.yml`).

See `docs/DEVELOPER_GUIDE.md` §9 for the full picture, including what the local gate
cannot catch.

## CI, deploys, and the repo

**The repo is public** (since 2026-09-22). Actions minutes are metered only on private
repos, so CI is free and unlimited — there is no minutes budget to conserve and no
reason to propose migrating to another CI vendor. Because it is public, never commit
anything that isn't safe to publish; `.gitignore` already covers `.env*`, and only
`.env.example` files belong in the tree.

Two workflows, with different trigger rules — do not conflate them:

- **`.github/workflows/ci.yml` (`Verify`) — manual only.** `workflow_dispatch`, no
  push/PR trigger. Run it with `gh workflow run ci.yml` when you need the full suite on
  a clean Linux runner, the slow `difficulty.test.ts`, or a check of a _merged_ result.
- **`.github/workflows/deploy.yml` — automatic, leave it alone.** Push to `main`
  deploys production; PRs get a Vercel preview. Do not add verification steps back into
  it, and do not give `ci.yml` automatic triggers without being asked — that was a
  deliberate move to local hooks.

**Never run `vercel deploy --prebuilt` from macOS.** The `@resvg/resvg-js` native
binding ships wrong and 500s the entire production API. Deploys go through CI only
(`gh run rerun <id>` to retry a failed one). Prod projects: web = `mpg-brown`,
api = `mpg-api-pink`.

**Diagnosing a dead workflow:** a run that fails in ~3s with zero steps executed is
GitHub refusing to start the job (billing/permissions), not a test failure — read the
job's step list before reading logs that don't exist.

**`tasks/` is gitignored** (`.gitignore:31`). The Kanban board is local-only, so board
edits never appear in a diff or PR and must not be "fixed" by adding them to git.

## Hard rule: no feature may break offline play

**The game must stay fully playable with every network service down.** Sharing,
leaderboards, chat, voice, presence, analytics — every one of them is an enhancement
layered on top of a game that already works locally, and none of them may become a
dependency of playing.

Concretely, any feature that talks to the network must:

- **Never block or delay gameplay.** No screen, move, or result waits on a request.
  Fire-and-forget, and let the result render immediately.
- **Degrade to absence, not to an error.** If the service is down, the affordance is
  simply not offered (no share button, no rank, chat controls blurred/disabled). A
  finished game never shows an error banner about something the player didn't ask for.
- **Never leave the player stranded.** No dead-end states, no retry loops in front of
  the board, no spinner that outlives a request.

Reviews should check this explicitly: unplug the backend and the whole single-player
catalogue must still be playable start to finish. See `docs/UX_PRINCIPLES.md` §7.
