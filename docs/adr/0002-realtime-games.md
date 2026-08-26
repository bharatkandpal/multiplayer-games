# ADR 0002 — Real-time arcade games alongside turn-based games

**Status:** Proposed
**Date:** 2026-08-26
**Deciders:** Bharat (lead)
**Decision lens:** Keep two game families coherent without contorting either abstraction
**Informed by:** throwaway spike on `feat/mpg-039-realtime-spike` (`apps/web/src/spike/floppy/`)

---

## Context

The platform today is built end-to-end around a **turn-based** abstraction:

- `GameModule<S, M, Line>` in `packages/engine` — pure rules
  (`legalMoves`/`applyMove`/`getResult`/`currentPlayer`/`evaluate`) plus a generic
  minimax AI, all N-player/seat-generic.
- A closed `GameId` registry (`registerGame`/`getGame`/`listGames`/`hasGame`) the room
  manager, transport and AI runner are written against.
- A web pipeline: `HomeScreen` (`GAME_CATALOG`) → `SetupScreen` (per-seat human/bot
  config) → `GamePlayScreen` + `useLocalPlayController` (applies human moves, paces bot
  moves via `pickMove`).

We now want a **second family**: real-time **solo arcade** games — Floppy Birds
(MPG-040), then Lumberjack/Timberman (MPG-041). Their nature is fundamentally different:

| Turn-based                             | Real-time arcade                                  |
| -------------------------------------- | ------------------------------------------------- |
| Discrete turns, one move at a time     | Continuous game loop (tick @ fixed Hz)            |
| `legalMoves` enumeration               | No move set — sampled input per tick              |
| Minimax opponent per seat              | No AI opponent, no evaluation function            |
| N seats (human/bot), turn order        | One player, no seats, no turn order               |
| Win/draw `Result` + winning line       | A **score**; game-over; (north-star) a leaderboard |
| Outcome = who is to move + terminality | Outcome = physics + input over time               |

**Why not force one abstraction onto the other.** Bending real-time into `GameModule`
would gut it: `legalMoves` becomes meaningless, `applyMove(state, move, player)` has no
player, `getResult` can't express a score, `currentPlayer` is nonsense, `evaluate`/minimax
are dead weight, and the room/AI runner would have to special-case a "game" that never
enumerates moves. Conversely, bending turn-based into a tick loop discards the very
enumeration + search that the minimax AI and server-authoritative legality depend on. The
two families share almost nothing at the *rules* layer — but they **do** share the
platform shell (catalog, "pick a game", theming, score/UX obligations). The design must
split at the rules layer and unify at the shell.

The one thing they genuinely share is the guardrail that makes ADR 0001 pay off: a
**pure engine** (no I/O, clock, or randomness in rules) with the impure loop/transport
outside it. That guardrail must survive into the real-time family too — and it's what
makes server-side score re-simulation (anti-cheat) reuse the same code, exactly as
shared rules do for turn-based.

## Decision

Introduce a **sibling** interface, `RealtimeModule<S, I>`, that lives next to
`GameModule<S, M, Line>` in `packages/engine`. It is a peer, not a subtype — the two do
not share a base interface (see Alternatives). They coexist by unifying only the thin
**catalog / "pick a game"** layer and splitting everything below it.

### 1. The `RealtimeModule` interface (pure, in `packages/engine`)

```ts
export interface RealtimeModule<S, I> {
  readonly id: RealtimeGameId;     // widens the registry key space; see §3
  readonly kind: "realtime";       // discriminator vs GameModule's "turn-based"
  readonly tickHz: number;         // fixed simulation rate the controller steps at

  /** Fresh state from a seed. ALL randomness derives from `seed` and is carried in S. */
  createInitialState(seed: number): S;

  /** Advance the sim by exactly one fixed tick. PURE: (state, input) → state. */
  tick(state: S, input: I): S;

  getScore(state: S): number;      // current run score
  isGameOver(state: S): boolean;   // score is final once true
}
```

Design commitments baked into this shape:

- **Purity, same as `GameModule`.** No `requestAnimationFrame`, no `Date.now()`, no
  `Math.random()` inside the module. The wall clock, the rAF loop, DOM input sampling and
  rendering all live in the web controller. This keeps the ADR-0001 guardrails intact for
  the new family.
- **Fixed-step determinism.** The module exposes `tickHz` and a pure `tick`; the
  controller accumulates real elapsed time and consumes it in whole ticks, so the sim is
  frame-rate independent. Given a seed and an input-per-tick sequence, a run is fully
  reproducible.
- **RNG lives *in state*, seeded.** `createInitialState(seed)` seeds a small PRNG whose
  state is carried inside `S` and advanced purely by `tick`. (The spike uses mulberry32.)
  This is the real-time analogue of the turn-based rule "easy-bot randomness lives in the
  AI layer via an injected RNG, never in the rules." It gives deterministic, replayable
  runs and makes the module unit-testable with no fakes: feed a seed + a scripted input
  array, assert on score/game-over — no timers, no DOM.
- **Input is a per-tick sample `I`**, module-defined (e.g. `{ flap: boolean }` as a
  rising edge; a continuous game could use `{ axis: number }`). The module never listens
  to events; the controller samples DOM input into the next tick's `I`.
- **Rendering is deliberately NOT in the module.** Mirroring how board renderers live in
  the web app (not in `GameModule`), the realtime module carries no `render()`. The web
  layer owns drawing, keyed by id. This keeps the engine renderer-agnostic and, crucially,
  does **not** commit the platform to a renderer — the three.js/WebGL vs Canvas/DOM
  decision stays parked (the spike uses Canvas 2D purely to de-risk the loop).
- **No seats, no `playerCount`, no `evaluate`/minimax, no `legalMoves`.** Solo by
  construction. If a future real-time game wants a bot, that's a *scripted input source*
  in the controller, not a search over a rules interface — out of scope here.

### 2. How the two coexist — split surface, unified catalog

**Unified (thin) — "pick a game":** Home should present both families in one grid.
Introduce a `kind` discriminator on catalog metadata so Home can render both and route
correctly. Concretely, the web `GAME_CATALOG` entry gains a `kind: "turn-based" |
"realtime"` field; the App router branches on it:

- turn-based → existing `SetupScreen` (seats) → `GamePlayScreen`.
- realtime → **straight to a new `RealtimePlayScreen`** (no `SetupScreen`, no seats —
  there is nothing to configure for a solo run; "Start" is the one primary action).

**Split (everything below):** a new, separate play surface for real-time —
`RealtimePlayScreen` + a `useRealtimeLoop` controller — parallel to
`GamePlayScreen`/`useLocalPlayController`. It is **not** a variant of the turn-based
controller; it owns the rAF loop, the fixed-step accumulator, input sampling, pause, and
the game-over/restart surface. Per-game wiring mirrors `screens/games.tsx`: a small map
from realtime `id` → `{ module, renderer }`.

### 3. Registry

Keep the two module families in **sibling registries** rather than one heterogeneous map,
so `GameModule`'s types never absorb realtime concerns (protects the MPG-031 plugin
boundary):

- Existing `registerGame`/`getGame`/`listGames` stay exactly as-is for `GameModule`.
- Add `registerRealtimeGame`/`getRealtimeGame`/`listRealtimeGames` for `RealtimeModule`.
- `GameId` stays the turn-based union; add a separate `RealtimeGameId` union
  (`"floppy-birds" | "lumberjack" | ...`). When MPG-031 opens games to plugins, both
  widen to `string` behind their registries — independently.
- The web builds its unified Home list from *both* `listGames()` and
  `listRealtimeGames()`, tagging each with `kind`. Home stays data-driven (it already
  filters to ids that have a catalog entry).

This is the smallest change that unifies the user-facing catalog while keeping the two
rules abstractions physically separate.

### 4. Score / leaderboard seam (design it now, build it later)

The leaderboard itself is north-star (accounts + Postgres, ROADMAP), but the **seam**
belongs in this decision so MPG-040/041 don't hard-code a dead end:

- `RealtimePlayScreen` takes an injected callback:
  `onRunComplete({ gameId, score, seed })` (optionally an input log — see below), fired
  once when `isGameOver` first flips true.
- POC implementation: it just renders "Final score / Play again". No network.
- North-star implementation: the same callback posts to a leaderboard service. Because
  the module is pure and deterministic from `(seed, inputLog)`, the **server can
  re-simulate the run with the same shared module to validate a submitted score** —
  anti-cheat for free, and a direct extension of ADR 0001's "one engine, both ends" bet
  to the real-time family. To enable that later without rework, `useRealtimeLoop` should
  record the per-tick input log now (cheap: one boolean/number per tick); whether we ship
  it in the POC payload is a later call, but the controller producing it is a
  low-cost hedge worth taking.

### 5. UX obligations (real-time still owes the bar)

Real-time games are not exempt from `UX_PRINCIPLES` — the DoD gates every task. Specific
obligations MPG-040/041 must meet (and that the shipped `RealtimePlayScreen`, unlike the
spike, must implement):

- **`prefers-reduced-motion`:** a score arcade game is intrinsically motion-heavy, so it
  can't simply "zero animations." Obligation: honor the preference by (a) offering a
  **pause** control and a clear paused state, (b) removing purely decorative parallax/juice
  when reduced-motion is set, and (c) not relying on motion alone to convey state
  (score/lives shown as text). A "reduced-motion → simpler visuals + no non-essential
  screen-shake/particles" path is the DoD interpretation here.
- **Pause/resume** is a first-class control (the spike stubs it), including auto-pause on
  tab blur/visibility change so a backgrounded tab doesn't "die" off-screen.
- **Designed states:** ready / running / paused / game-over are all explicit, with one
  clear primary action each (Start, Play again) — same DoD as turn-based screens.
- **Input a11y:** keyboard (Space/Arrow) parity with pointer/tap; visible focus.

### 6. What's genuinely shared vs newly built

| Shared / reused                                   | Newly built for real-time                          |
| ------------------------------------------------- | -------------------------------------------------- |
| Pure-engine guardrail (no I/O/clock/rng in rules) | `RealtimeModule<S, I>` interface + PRNG-in-state   |
| The "pick a game" Home catalog (data-driven)      | `kind` discriminator on catalog + router branch    |
| Design tokens, theme, UI components, motion tokens| `RealtimePlayScreen` + `useRealtimeLoop` (rAF)     |
| Deterministic-test discipline                     | Fixed-step accumulator; per-game renderer map      |
| ADR-0001 shared-engine → server re-sim for scores | `RealtimeGameId` + sibling realtime registry       |
| —                                                 | Score / `onRunComplete` leaderboard seam           |

Nothing in `GameModule`, `useLocalPlayController`, `GamePlayScreen`, `SetupScreen`, or the
turn-based registry changes. The real-time track is **purely additive**.

## Alternatives considered

1. **Extend `GameModule` (add optional `tick`/`score`, make `move` optional).**
   Rejected. It poisons the interface every turn-based game and the room/AI runner are
   written against: `legalMoves`/`currentPlayer`/`evaluate` become "sometimes
   meaningless," and consumers grow `if (isRealtime)` branches. It directly undermines the
   clean `GameModule` boundary MPG-031 (plugin API) depends on. The families share no
   *rules* surface; a shared rules interface is a false unification.

2. **A totally separate app / route silo for arcade games.**
   Rejected as the primary structure (though the spike is deliberately siloed). It
   duplicates the shell — catalog, theming, tokens, "pick a game" — and fractures the
   product into two front doors, which fights the north-star of a single event platform
   where people browse and pick any game. We want *one* catalog, *two* play surfaces, not
   two apps.

3. **A generic `Playable` supertype over both families.**
   Rejected. The only honest common members are `id`, `kind`, and "produces an outcome" —
   too thin to earn a shared abstraction, and every real consumer (loop vs turn scheduler,
   renderer, outcome shape) must still switch on `kind` and narrow. A premature supertype
   adds indirection without removing a single branch. The `kind`-tagged **catalog entry**
   (metadata, not behavior) already delivers the only unification that pays: a single Home
   list. If a third family ever appears and real shared behavior emerges, we can extract a
   supertype then — cheaply, because both families already carry `kind`.

## Consequences

**Positive**

- Each family keeps a crisp, purpose-built interface; neither is contorted.
- Real-time track is additive: zero change to turn-based engine/controller/screens.
- Determinism (seed + fixed-step + PRNG-in-state) makes real-time modules unit-testable
  with no fakes, and sets up server-side score validation as a straight reuse of the
  shared engine — extending the ADR-0001 bet, not reopening it.
- One catalog / one front door preserves the single-platform north-star.

**Negative / risks (and mitigations)**

- *Two play surfaces to maintain.* → They're genuinely different; the alternative
  (one contorted surface) is worse. Shared shell (tokens/components) limits duplication.
- *Renderer decision still open.* → Intentional. The module carries no renderer; MPG-040
  ships Canvas/DOM, and a later ADR can adopt WebGL for the *web renderer* without
  touching any `RealtimeModule`.
- *Reduced-motion for a motion-native genre is a real UX design problem.* → Addressed
  explicitly in §5 as a DoD obligation, not deferred to a polish phase.
- *Two registries / two id unions is mild duplication.* → Small, and it's what keeps the
  `GameModule` plugin boundary (MPG-031) uncontaminated.

## Recommendation — what MPG-040 and MPG-041 build against

1. Land `RealtimeModule<S, I>` + `RealtimeGameId` + the sibling realtime registry in
   `packages/engine` (pure; PRNG-in-state; no renderer). Add unit tests that drive
   `tick` with a seed + scripted input array and assert score/game-over — no timers/DOM.
2. Build `RealtimePlayScreen` + `useRealtimeLoop` in the web app (rAF loop, fixed-step
   accumulator, input sampling, pause + auto-pause on blur, ready/running/paused/over
   states, `onRunComplete({ gameId, score, seed })`, reduced-motion handling per §5).
   Record the per-tick input log in the controller (hedge for server re-sim).
3. Add `kind` to the web catalog entry and branch the App router: `realtime` skips
   `SetupScreen`. Home lists both `listGames()` and `listRealtimeGames()`.
4. **MPG-040 (Floppy Birds):** implement `floppyBirds: RealtimeModule<FloppyState,
   {flap:boolean}>`; provide a Canvas/DOM renderer keyed by its id. The spike's
   `floppyModule.ts` is a working reference for state/tick/collision/scoring — reimplement
   it to spec and to the UX bar; do not import the spike.
5. **MPG-041 (Lumberjack):** implement `lumberjack: RealtimeModule<..., {chop:"left"|"right"}>`
   against the identical interface and the same screen/controller — proving the abstraction
   generalizes beyond one toy.

The `GameModule` boundary is untouched; the real-time family is a clean sibling.

## Revisit triggers

- A real-time game that genuinely needs multiple concurrent live players (shared-clock
  multiplayer) — that reopens seats/authority/transport for the real-time family and is a
  bigger decision than this solo-score ADR.
- A third game family emerging with real behavioral overlap with one of these two —
  reconsider extracting a `Playable` supertype (cheap now that both carry `kind`).
- The renderer decision (three.js/WebGL) being taken — a separate ADR; should not require
  any change to `RealtimeModule`.
- Server-side score validation becoming a hard requirement — promotes the input-log hedge
  from "recorded" to "part of the submission payload."
