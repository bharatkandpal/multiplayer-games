# Architecture

**Status:** Draft v0.2 · **Related:** [TDD.md](TDD.md) · [PRD.md](PRD.md) ·
[ADR 0007](adr/0007-variants-and-customization.md)

> **Updated 2026-09-07** for the virality/creator direction (PRD v1.0). Two layers are new:
> **Variants** (§9) and **sharing & discovery** (§10). The room/seat/engine core below is
> unchanged — that's the point of the variant design.
>
> **This document describes the target architecture, not the state of `main`.** As of
> 2026-09-07 the backend exists only on an unmerged branch (`feat/mpg-055-leaderboard`);
> `main` is local-play only. See ROADMAP §3z / MPG-084.

---

## 1. System Overview

```
        ┌──────────────────────────────────────────────────────────┐
        │                        Browser (React)                    │
        │  Screens: Home(Featured/Trending/New) · Setup · GameRoom  │
        │           · Result/Share · Customize · Variant            │
        │  Shared engine (validation, optimistic render)            │
        │  Renderers ← cosmetics/assets (NEVER the engine)          │
        └───────────────┬───────────────────────┬──────────────────┘
              HTTPS (REST)                WSS (Socket.IO)
                        │                         │
        ┌───────────────▼─────────────────────────▼──────────────────┐
        │                     Node.js Backend                         │
        │  HTTP: rooms, variants, scores, share links, card images    │
        │  WS: join/move/rematch                                      │
        │  Room Manager · Turn/Auth enforcement                       │
        │  Shared engine (AUTHORITATIVE) · Server-side AI (minimax)   │
        │  Score validator (re-simulation) · Param validator          │
        └──────────┬──────────────────────────────────┬───────────────┘
                   │                                  │
           ┌───────▼────────┐              ┌──────────▼───────────┐
           │     Redis      │              │   Durable store      │
           │ room:{id} TTL  │              │ variants · scores ·  │
           │ (in-mem in dev)│              │ share links · handles│
           └────────────────┘              └──────────────────────┘
             EPHEMERAL                          PERSISTENT
```

The **same engine package** runs in the browser (optimistic UI) and on the server
(source of truth). Clients propose moves; the server decides.

**The new storage split matters.** Rooms stay ephemeral with a TTL — a room is a
conversation. Variants, scores, share links, and handles are **durable by design**: they
are the artifacts the viral loop shares, and a share link that dies with its room is not a
share link (PRD §13).

## 2. Component Responsibilities

- **Web client** — rendering, input, optimistic updates, socket lifecycle,
  share-link UI. Never the authority on outcomes.
- **HTTP layer** — room creation, health/metrics. Stateless.
- **WS layer** — per-room event handling: `join`, `move`, `rematch`, disconnect.
- **Room Manager** — creates/loads/expires rooms, maps sockets → player slots,
  enforces turns, drives AI, broadcasts state.
- **Engine (shared)** — pure rules + AI heuristics. Deterministic, tested in isolation.
- **AI runner (server)** — minimax + alpha-beta over the engine; difficulty policy.
- **Store (Redis)** — ephemeral room state with TTL; in-memory adapter for local dev.

## 3. There is one model: seats

No separate "AI mode" and "multiplayer mode." A room has **N seats**, each `human` or
`bot` (with its own level). The experience is emergent from the seat configuration:

| "Mode"             | Seat config       | Sockets               | Sharing           | Bot moves               |
| ------------------ | ----------------- | --------------------- | ----------------- | ----------------------- |
| Play vs bot        | 1 human + 1 bot   | 1                     | none              | server auto-runs        |
| Play with a friend | 2 humans          | 2                     | invite link       | —                       |
| Fill empty seat    | human(s) + bot(s) | ≥1                    | link (for humans) | server auto-runs        |
| Watch (bot-vs-bot) | all bots          | 0 players; N watchers | link (optional)   | server auto-runs, paced |

The Room Manager runs a **single turn-advancement loop** (TDD §6.1): when the seat on turn
is a bot, it invokes the AI runner at that seat's level and applies the move; when it's a
human, it waits for that socket's intent. Mixed bot levels and all-bot rooms fall out for free.

## 4. Realtime Sequence — PvP Move

```
Player A            Server (authoritative)            Player B
   │  move(a) ───────────►│
   │                      │ validate turn + legality (engine)
   │                      │ applyMove → new state, flip turn
   │  ◄── game:update ────┤──── game:update ──────────►│
   │                      │ if terminal:
   │  ◄── game:over ──────┤──── game:over ────────────►│
```

## 5. Realtime Sequence — seat with a bot on turn

```
Human seat        Server (turn-advancement loop)
  │ move(h) ────────►│ validate + apply human move (engine)
  │                  │ advance turn → next seat is a BOT?
  │                  │   AI runner: pickMove(state, seat.difficulty)
  │                  │   (wait pacingMs) apply bot move (engine)
  │ ◄─ game:update ──┤  loop continues while next seat is a bot
  │ ◄─ game:over ────┤  if terminal
```

## 5a. Realtime Sequence — watch mode (all bots)

```
Watcher(s)        Server
  │  join(watch) ───►│ status: active, first turn = slot 1 (a bot)
  │                  │ loop: pickMove(seatA.level) → apply → (pacingMs)
  │ ◄─ game:update ──┤        pickMove(seatB.level) → apply → (pacingMs)
  │ ◄─ game:update ──┤ ... until terminal ...
  │ ◄─ game:over ────┤
```

No player intents arrive; the loop self-drives, emitting a paced `game:update` per bot
move so watchers can follow. This is the seed of north-star spectator mode.

## 6. State Ownership

- **Authoritative state:** server, in Redis (`room:{roomId}`).
- **Derived/optimistic state:** client, always reconciled to the last server broadcast.
- **Conflict rule:** server broadcast wins; client re-renders from it.

## 7. Scaling Path

Two different load shapes now, with different answers.

**Realtime/room load** (unchanged reasoning): single node today. To scale, enable the
**Socket.IO Redis adapter** so any node can serve any room, plus sticky sessions at the LB.
**Spectator fan-out** is read-only subscribers to a room's broadcast channel, not seats —
broadcasting one game to a few hundred watchers is trivial for Socket.IO. **Bots** are
stateless per call, so they move to a worker pool if concurrent bot rooms strain a node.

**Viral/read load** (new, and the one that spikes): a share that lands well sends a burst of
_readers_ — link unfurls, card images, variant pages, leaderboards, Trending. This traffic
is overwhelmingly cacheable and mostly not WebSocket:

- **Card images are generated once and cached hard** (immutable per result), served from the
  CDN. A social platform's scraper must never trigger a render.
- **Discovery surfaces are cached with short TTLs** — Trending is a ranked read model, not a
  live query over the score table.
- **Unfurl requests are bots, not players** — they must never touch the room path.
- The asymmetry is the point: a viral spike is a read spike, and reads scale with cache.

**Persistence.** Durable state (variants, scores, share links, handles) needs a real
database — Postgres is the assumed destination, and it now arrives with **Phase 3**, not
with event mode as previously planned. Redis stays for ephemeral rooms.

These numbers are why the TypeScript stack holds rather than needing an Elixir-class
runtime — see [ADR 0001](adr/0001-tech-stack.md).

## 8. Adding a New Game (extensibility)

1. Implement `GameModule` in `packages/engine` (state, moves, win check, evaluate).
2. Register it in `registry.ts`.
3. Add a heuristic under `ai/heuristics/` (or reuse a generic one).
4. Add a board renderer component in the web app.
5. _(New)_ Optionally declare a **cosmetic schema** and a **`ParamSchema`** so the game
   participates in variants (§9).
6. No changes needed to Room Manager, transport, or AI runner — they're generic.

## 9. Variants (customization layer)

Per [ADR 0007](adr/0007-variants-and-customization.md), a **Variant** is a named, ownable,
shareable **data object** — `baseGameId + cosmetics + params + (later) assets`. Playing a
variant is playing the base game; no module is forked, duplicated, or modified.

```
   Variant (data)                      Where it is read
   ─────────────────────────────       ────────────────────────────────────────
   cosmetics  (L1, fixed palettes)  ─▶ RENDERERS ONLY — no engine field exists
   assets     (L3, moderated)       ─▶ RENDERERS ONLY — same rule as L1
   params     (L2, declared schema) ─▶ ENGINE — but only after server validation
                                        ┌──────────────────────────────────┐
   client params ──────────────────────▶│ Param validator (server)         │
                                        │ re-derives config from ITS schema│
                                        └───────────────┬──────────────────┘
                                                        ▼
                                        same module + same validated config
                                        on both sides → determinism holds
                                        → re-simulation anti-cheat still works
```

**The invariant this protects.** Real-time scores are trusted only because the server can
replay the player's input log through the same deterministic module and get the same score
(MPG-065). Cosmetics can't threaten that — there is no field through which they could reach
the engine. Params can, so they are never trusted from the client: the server validates
against its own copy of the schema and re-derives the config.

**Leaderboard scoping.** L1 variants share the base game's board (a hat is not an
advantage). L2/L3 variants get a board keyed by **parameter hash**; the base game's board
stays canonical.

## 10. Sharing & Discovery

```
  run ends ──▶ score submitted ──▶ [server validates: re-simulation / game:over]
                                              │
                                    only validated scores written
                                              ▼
                              ┌───────────────────────────────┐
                              │ durable store                 │
                              │ scores · variants · links     │
                              └───┬───────────┬───────────────┘
                                  │           │
                  ┌───────────────▼──┐    ┌───▼─────────────────┐
                  │ share link route │    │ ranked read models  │
                  │ + OG/Twitter meta│    │ Featured (curated)  │
                  │ + card image (CDN)│   │ Trending (velocity) │
                  └────────┬─────────┘    │ New                 │
                           │              └─────────┬───────────┘
                     social platform                │
                       unfurls card                 ▼
                           │                   Home screen
                           └──▶ new visitor ──▶ play (no signup) ──▶ loop
```

Design rules that follow:

- **Every shareable route is server-rendered enough to carry OG/Twitter metadata.** A
  client-only SPA route does not unfurl — scrapers don't run JS.
- **Share links are durable and unguessable**, and outlive any room.
- **Only server-validated outcomes** are eligible for a card or a board. Discovery built on
  fabricated scores is worse than no discovery (PRD §10).
- **Trending is a read model**, recomputed on a schedule, not a live aggregate query.
- **Featured is curated** and carries the cold start, when Trending has no honest signal.
