# CLAUDE.md

Project guidance for Claude Code.

## Before calling any change done

Always run lint and typecheck (not just the test suite — Vitest alone does not typecheck;
this repo's web tsconfig includes tests, so a change can pass `vitest` and still fail
`tsc`). Run both per-package (`pnpm typecheck`, `pnpm lint`) and fix failures before
reporting work as complete or opening a PR.
