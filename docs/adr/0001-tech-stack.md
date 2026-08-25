# ADR 0001 — Core Technology Stack

**Status:** Accepted
**Date:** 2026-08-24
**Deciders:** Bharat (lead)
**Decision lens:** Long-term platform bet

---

## Context

We're building a web platform for small, turn-based, server-authoritative multiplayer
games (launch: Connect Four, Tic-Tac-Toe) with a minimax AI opponent and shareable-link
PvP. The stack choice was made on technical merit and long-term platform strategy —
explicitly **not** on the lead's personal stack experience (the team can staff and hire
across multiple stacks).

### Forces (ranked by weight for this problem)
1. **One source of truth for game rules** — rules + minimax must be identical on the
   authoritative server and (ideally) reusable on the client for optimistic UI. Duplicating
   rules across two languages is the dominant long-term risk.
2. **Ease of adding games** — a reusable framework is the core value proposition.
3. **Developer velocity + hiring breadth.**
4. **Realtime transport** — turn-based, ~2 players/room. Light; almost any stack clears it.
5. **Concurrency/scale** — modest at launch (hundreds of rooms), not yet a differentiator.

## Options Considered

| Stack | Rules code-share | Realtime fit | Talent pool | Notes |
|-------|------------------|--------------|-------------|-------|
| **TypeScript both ends** | ✅ one engine, one test suite | Good enough | Largest | Wins the dominant axis (#1). |
| Elixir/Phoenix | ❌ server-only rules | ✅ Best-in-class | Smaller | Overkill on realtime we don't need; loses on #1. |
| .NET (SignalR + Blazor) | ⚠️ partial (Blazor WASM) | ✅ Strong | Large (enterprise) | Viable if bench were .NET-heavy. |
| Go + React | ❌ duplicated rules | ✅ Excellent | Large | Max engine perf we won't need; loses on #1. |

## Decision

**TypeScript on both client and server.**
- **Frontend:** React + Vite.
- **Backend:** Node.js + Socket.IO (server-authoritative).
- **Shared:** a pure, framework-agnostic `packages/engine` (rules + minimax + types)
  imported by both apps — one implementation, one test suite.
- **Ephemeral state:** Redis (in-memory adapter for local dev).
- **Persistence:** deferred to Postgres when accounts/stats arrive.

### Rationale under the "long-term platform bet" lens
The single biggest compounding advantage as the catalog grows is a **shared rules+AI
engine** — every new game is written once and is automatically consistent between
authoritative server and optimistic client, with a single test suite. TypeScript is the
only mainstream option delivering that *and* the deepest hiring pool. A stricter
"long-term realtime platform" reading would favor Elixir/Phoenix, but its realtime
strengths address needs (twitch latency, huge fan-out, presence-heavy) that turn-based
2-player games don't have — and it forfeits the shared-engine advantage that actually
compounds for us.

## Consequences

**Positive**
- One language, one engine, one test suite across client + server.
- New games are additive (`GameModule` + a renderer); transport/AI stay generic.
- Largest talent pool; easy to staff from a mixed-stack team.

**Negative / risks (and mitigations — this is how we keep the long-term bet safe)**
- *Realtime scaling isn't free like Elixir/OTP.* → Adopt the **Socket.IO Redis adapter**
  + sticky sessions when we exceed one node; design the transport layer behind a thin
  interface so it can be swapped without touching game code.
- *Node isn't the fastest for deep minimax.* → Connect Four is depth-limited with
  alpha-beta + move ordering (bitboards later if needed); AI is stateless per call and
  can move to a **worker pool / serverless** if Hard-mode compute becomes a bottleneck.
- *No compile-time null safety like some alternatives.* → `strict` TS, exhaustive engine
  unit tests, and runtime validation on all socket payloads.

## Guardrails to protect the bet
1. **Engine stays pure** — no I/O, clock, or randomness inside `packages/engine`; that keeps
   it portable if any runtime ever changes.
2. **Transport is an interface** — room/move events go through an abstraction, not raw
   Socket.IO calls scattered through game logic, so the realtime layer is replaceable.
3. **AI is stateless** — pure `(state, difficulty) → move`, so it can scale out independently.

## North-star check: does the event vision reopen this?

The product's north-star is a company/HR **event platform** — 100–200 employees watching
and playing together, with spectators and a big-screen view (PRD §1). Presence-heavy work
is exactly where Elixir/OTP shines, so it's worth checking whether it reopens the decision.

**It doesn't** — because the *absolute* numbers are modest. Hundreds of concurrent
connections with spectator fan-out (broadcasting one game to a few hundred read-only
watchers) is comfortably within Node + Socket.IO + the Redis adapter. Elixir-class
concurrency earns its keep at **tens of thousands** of concurrent sessions or twitch-latency
fan-out, not hundreds. So the concrete event target **reinforces** the TypeScript choice and
the shared-engine advantage, rather than overturning it.

## Revisit triggers
- Concurrency growing past ~single-digit **thousands** simultaneous, or spectator fan-out
  into the tens of thousands, that Node + Redis adapter can't meet economically.
- A shift toward realtime/twitch games where OTP's supervision/latency model would materially help.
- Available developer bench becoming overwhelmingly single-stack (e.g. all .NET).
