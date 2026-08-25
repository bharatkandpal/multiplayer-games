---
name: add-game
description: The repeatable recipe to add a new game to the multiplayer-games platform. Use whenever adding or scaffolding a new game (a new GameModule + board renderer), or when asked "how do I add a game", "add game X", "scaffold a new game". Ensures the game plugs into the generic engine, AI, transport, and UI with no changes to the platform core.
---

# Adding a new game

The platform is game-agnostic: the room manager, transport, and AI runner are generic. A new
game is **additive** — you implement one `GameModule` + a renderer and register it. Do **not**
special-case a game in the room/transport/AI layers.

## Prerequisites (read)

- `docs/TDD.md` §4 (the `GameModule` interface), `docs/GAME_LOGIC.md` (rules + minimax + heuristics),
  `docs/UX_PRINCIPLES.md` (the UX DoD your renderer must meet).

## Steps

1. **Engine module** — `packages/engine/src/<game>.ts` implementing `GameModule`:
   - `createInitialState()`, `legalMoves(state)`, `applyMove(state, move, player)` (throws on
     illegal), `getResult(state)`, `currentPlayer(state)`, `evaluate(state, forPlayer)`.
   - Keep it **pure and N-player-generic** (acting player is a parameter; no hardcoded 2, no
     I/O/clock/randomness).
2. **Types** — define the game's `State` and `Move` as discriminated unions in the module (or
   `types.ts`); export them.
3. **Register** — add the module to `packages/engine/src/registry.ts` under its `GameId`.
4. **Heuristic** — add `ai/heuristics/<game>.ts` (or reuse a generic one) and wire move
   ordering if it helps alpha-beta. Verify the AI move-time budget holds at Hard.
5. **Engine tests (Vitest)** — exhaustive win/draw detection, legal-move gen, illegal-move
   rejection; AI strength assertions (Hard never loses / beats random; Hard ≥ Medium ≥ Easy).
6. **Renderer** — a board component in `apps/web/src/components/` using the design system.
   Must meet the UX DoD: all required states, keyboard + ARIA, not color-only, responsive,
   meaningful motion, optimistic move rendering reconciled to the server broadcast.
7. **Seat metadata** — declare the game's supported seat count/config so the setup screen can
   render seat options (and validate on `POST /api/rooms`).
8. **Wire nothing else** — room manager, turn-advancement loop, AI runner, and transport are
   generic. If you find yourself editing them for one game, stop and rethink the abstraction
   (escalate to `staff-architect`).

## Definition of done

- Playable vs bot (all levels), 1v1 via link, and all-bot watch — with no core changes.
- Engine tests green; renderer passes UX review; API contract unchanged (or spec updated).
