# CLAUDE.md

Project guidance for Claude Code.

## Before calling any change done

Always run lint and typecheck (not just the test suite — Vitest alone does not typecheck;
this repo's web tsconfig includes tests, so a change can pass `vitest` and still fail
`tsc`). Run both per-package (`pnpm typecheck`, `pnpm lint`) and fix failures before
reporting work as complete or opening a PR.

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
