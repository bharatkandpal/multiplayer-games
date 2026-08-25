# Architecture

**Status:** Draft v0.1 · **Related:** [TDD.md](TDD.md)

---

## 1. System Overview

```
        ┌──────────────────────────────────────────────────────────┐
        │                        Browser (React)                    │
        │  Screens: Home · Setup · GameRoom · Result                │
        │  Shared engine (validation, optimistic render)            │
        └───────────────┬───────────────────────┬──────────────────┘
              HTTPS (REST)                WSS (Socket.IO)
                        │                         │
        ┌───────────────▼─────────────────────────▼──────────────────┐
        │                     Node.js Backend                         │
        │  HTTP: create room, health   WS: join/move/rematch          │
        │  Room Manager · Turn/Auth enforcement                       │
        │  Shared engine (AUTHORITATIVE) · Server-side AI (minimax)   │
        └───────────────┬─────────────────────────────────────────────┘
                        │
                ┌───────▼────────┐
                │     Redis      │  room:{id} (JSON + TTL)
                │ (in-mem in dev)│
                └────────────────┘
```

The **same engine package** runs in the browser (optimistic UI) and on the server
(source of truth). Clients propose moves; the server decides.

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

| "Mode" | Seat config | Sockets | Sharing | Bot moves |
|--------|-------------|---------|---------|-----------|
| Play vs bot | 1 human + 1 bot | 1 | none | server auto-runs |
| Play with a friend | 2 humans | 2 | invite link | — |
| Fill empty seat | human(s) + bot(s) | ≥1 | link (for humans) | server auto-runs |
| Watch (bot-vs-bot) | all bots | 0 players; N watchers | link (optional) | server auto-runs, paced |

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

## 7. Scaling Path (toward the event north-star)

The north-star is a company event: **100–200 concurrent participants + spectators** (see
PRD §1). That's presence-heavy but modest in absolute numbers — well within reach:

- Single node for the POC. To scale: enable the **Socket.IO Redis adapter** so any node can
  serve any room, plus sticky sessions at the LB.
- **Spectator fan-out** (the new event requirement): spectators are read-only subscribers to
  a room's broadcast channel, not seats. Broadcasting one game to a few hundred watchers is
  trivial for Socket.IO; a shared big-screen view is just another subscriber.
- **Bots at event scale:** AI is stateless per call → move to a worker pool / serverless if
  many concurrent bot rooms strain a node. Bot-vs-bot exhibition games are a natural event feature.
- Add Postgres when accounts/stats/leaderboards/tournaments arrive with event mode.
- These numbers are why the TypeScript stack holds rather than needing an Elixir-class
  runtime — see [ADR 0001](adr/0001-tech-stack.md).

## 8. Adding a New Game (extensibility)

1. Implement `GameModule` in `packages/engine` (state, moves, win check, evaluate).
2. Register it in `registry.ts`.
3. Add a heuristic under `ai/heuristics/` (or reuse a generic one).
4. Add a board renderer component in the web app.
5. No changes needed to Room Manager, transport, or AI runner — they're generic.
