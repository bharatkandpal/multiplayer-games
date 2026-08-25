# Technical Design Document (TDD)

**Product:** Multiplayer Games Platform
**Status:** Draft v0.1
**Last updated:** 2026-08-20
**Related:** [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [GAME_LOGIC.md](GAME_LOGIC.md), [API_SPEC.md](API_SPEC.md)

---

## 1. Summary

We build a server-authoritative, real-time game platform. A shared **game engine**
(pure functions: state + move → new state, plus win/legal checks) runs on both the
client (for optimistic rendering & AI-free local validation) and the server (as the
source of truth). Real-time multiplayer uses WebSockets (Socket.IO). AI opponents
run **server-side** using minimax with alpha-beta pruning.

Design principle: **the engine is pure and framework-agnostic**, so the same rules
power AI mode, multiplayer mode, and tests without duplication.

## 2. Technology Choices

| Layer              | Choice                                                 | Rationale                                                                                                                                       |
| ------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Language           | TypeScript (front + back)                              | One language, shared engine + types across client/server.                                                                                       |
| Frontend           | React + Vite                                           | Fast dev, component model fits board UI.                                                                                                        |
| Styling            | CSS Modules + CSS-variable tokens (decided 2026-08-25) | Zero-runtime, Vite-native, scoped; tokens as CSS custom properties themed via `data-theme` (light/dark). Best fit for a bespoke UX-centric kit. |
| Realtime transport | Socket.IO                                              | Rooms, reconnection, fallbacks out of the box.                                                                                                  |
| Backend            | Node.js + Express (HTTP) + Socket.IO                   | Same runtime as engine; simple.                                                                                                                 |
| Ephemeral state    | Redis                                                  | Room/game state, TTL expiry, horizontal scale later.                                                                                            |
| Persistent store   | Postgres (Phase 3+)                                    | Accounts/stats when we add them. Not in v1.                                                                                                     |
| Monorepo tooling   | pnpm workspaces (or npm)                               | Share `packages/engine` between apps.                                                                                                           |
| Tests              | Vitest + Playwright                                    | Unit for engine/AI, e2e for flows.                                                                                                              |

> **Decision status: ACCEPTED** — see [ADR 0001](adr/0001-tech-stack.md). TypeScript
> both ends was chosen on technical merit + long-term platform strategy (not stack
> familiarity). The compounding win is a single shared rules+AI engine across the
> authoritative server and optimistic client. Guardrails to keep the long-term bet
> safe: engine stays pure, transport is behind a swappable interface, AI is stateless
> and horizontally scalable.

## 3. Repository Structure

```
multiplayer-games/
├── packages/
│   └── engine/              # Pure game logic, shared client+server
│       ├── src/
│       │   ├── types.ts     # GameState, Move, Player, Result
│       │   ├── connect4.ts  # rules + win detection
│       │   ├── tictactoe.ts # rules + win detection
│       │   ├── registry.ts  # game id -> engine module
│       │   └── ai/
│       │       ├── minimax.ts   # generic minimax + alpha-beta
│       │       └── heuristics/  # per-game evaluation functions
│       └── tests/
├── apps/
│   ├── web/                 # React client
│   │   └── src/
│   │       ├── screens/     # Home, GameSetup, GameRoom, Result
│   │       ├── components/  # Board, Cell, TurnIndicator, ShareLink...
│   │       ├── net/         # socket client, event hooks
│   │       └── state/       # local game store
│   └── server/              # Node backend
│       └── src/
│           ├── http/        # REST: create room, health
│           ├── ws/          # socket handlers, room manager
│           ├── rooms/       # room lifecycle, matchmaking-by-link
│           ├── ai/          # server-side AI runner (uses engine)
│           └── store/       # Redis adapter (in-memory fallback for dev)
├── docs/
└── README.md
```

## 4. Core Abstractions

### 4.1 Game Engine (pure)

Every game implements one interface so the platform is game-agnostic:

```ts
interface GameModule<S = unknown, M = unknown> {
  id: GameId; // 'connect4' | 'tictactoe'
  createInitialState(): S;
  legalMoves(state: S): M[];
  applyMove(state: S, move: M, player: Player): S; // throws on illegal
  getResult(state: S): Result; // { status: 'in_progress'|'win'|'draw', winner? }
  currentPlayer(state: S): Player;
  // AI support:
  evaluate(state: S, forPlayer: Player): number; // heuristic score
}
```

- **Pure & deterministic** — no I/O, no clock, no randomness (Easy AI's randomness
  lives in the AI layer, not the engine). Trivially unit-testable.
- The same `applyMove` validates moves on the **server** (authoritative) and can be
  used on the **client** for optimistic UI.

### 4.2 Bots / AI (server-side)

Generic `minimax(state, depth, alpha, beta, maximizingPlayer, gameModule)` returns
the best move and score. Difficulty maps to search depth + randomness (see
[GAME_LOGIC.md](GAME_LOGIC.md)). Bots run on the server so we never trust the client
and can cache/scale independently. For tiny games (Tic-Tac-Toe) minimax solves the
full tree; for Connect Four we depth-limit + use a heuristic.

A **bot is bound to a seat**, not to the room — so a single room can hold bots at
**different levels** (e.g. Medium vs Hard), or all-bot rooms for watch mode. The AI
runner is stateless: `pickMove(state, gameModule, difficulty) → move`. When it becomes a
bot seat's turn, the Room Manager invokes the runner for _that seat's_ difficulty and
applies the move. For watchability, bot-vs-bot rooms insert a small pacing delay
(~600ms, config) between moves.

### 4.3 Room / Seat model (the core abstraction)

- **Room** = one game session with **N seats**. There is no `mode` field — the "mode" is
  emergent from how seats are filled (all-human, human+bot, all-bot).
- **Seat** = `{ slot, kind: 'human' | 'bot', difficulty?, socketId?, displayName?, team?, connected }`.
  A `human` seat may be open (no `socketId` yet, joinable via link) or occupied. A `bot`
  seat carries its own `difficulty`.
- Room lives in Redis (or in-memory in dev) keyed by unguessable `roomId`.
- **N-seat capable:** the POC creates 2-seat games, but nothing hardcodes 2. Teams use the
  `team` field; 3+ player games just have more seats.
- **Server is authoritative:** clients send _intents_ (move requests) for their human
  seat; the server validates via the engine, drives bot seats via the AI runner, updates
  state, and broadcasts. Spectators (north-star) attach as read-only subscribers, not seats.

## 5. Data Model (ephemeral, v1)

```ts
type Difficulty = "easy" | "medium" | "hard";

type Seat = {
  slot: number; // 1..N, position in turn order
  kind: "human" | "bot";
  difficulty?: Difficulty; // bot seats only
  socketId?: string; // human seats; absent = open/joinable
  displayName?: string;
  team?: number; // for team modes (2v2); undefined = free-for-all
  connected: boolean;
};

type Room = {
  roomId: string; // e.g. 12-char base62, unguessable
  gameId: "connect4" | "tictactoe";
  state: GameState; // engine state (opaque JSON)
  seats: Seat[]; // N seats; POC = 2. No `mode` — it's emergent from seats.
  status: "waiting" | "active" | "finished" | "abandoned";
  turn: number; // slot whose turn it is
  pacingMs?: number; // delay between auto (bot) moves, for watchability
  createdAt: number;
  expiresAt: number; // TTL; waiting rooms expire faster than active
};
```

Redis keys: `room:{roomId}` (JSON, with TTL). No PII persisted. "Waiting" = at least one
open human seat still needs a player; a room with no open human seats (e.g. all-bot watch,
or all humans joined) can go straight to `active`.

## 6. Key Flows

### 6.1 Turn advancement (unified — humans and bots)

One loop drives every seat type. After any applied move:

1. Server applies the move via the engine, checks the result.
2. If terminal → broadcast `game:over`. Else advance `turn` to the next seat.
3. **Look at the seat now on turn:**
   - `human` → wait for that socket's `move` intent (broadcast `game:update` so the client renders).
   - `bot` → invoke the AI runner with _that seat's_ `difficulty`, apply the move (after an
     optional `pacingMs` delay), then repeat from step 1.
4. This naturally handles: human-vs-bot (bot moves auto-run between human moves),
   **mixed-level bots**, and **all-bot watch rooms** (the loop runs bot→bot until terminal,
   emitting a paced `game:update` per move so a spectator can follow along).

> Bots run **server-side** (single authoritative path, thin client). Because the engine +
> minimax are shared TS, a bot _could_ run client-side for a pure solo game, but we keep it
> server-side so the same loop serves solo, link-share, and watch rooms identically.

### 6.2 Create room with a seat configuration

1. Host `POST /api/rooms` `{ gameId, seats }` where `seats` declares each slot as
   `human` (self, or open/joinable) or `bot` (with a `difficulty`). Examples:
   - vs bot → `[{human, self}, {bot, hard}]`
   - link-share → `[{human, self}, {human, open}]` → returns invite URL
   - watch → `[{bot, medium}, {bot, hard}]`
2. Server creates the room; `status: waiting` if any open human seat remains, else `active`.
3. Host socket connects and `join`s its seat. Each open human seat is filled by whoever
   opens the invite link (`join` → next open human seat). All-bot rooms need no join.
4. When no open human seats remain, server broadcasts `game:start`, sets first turn to
   slot 1, and runs the turn-advancement loop (§6.1) — which auto-plays any leading bot seats.

### 6.3 Move sync (PvP)

1. Player emits `move` `{ roomId, move }`.
2. Server checks it's that player's turn + move is legal (engine).
3. Server applies, flips turn, computes result, broadcasts `game:update`.
4. On terminal result, broadcasts `game:over`.

### 6.4 Disconnect / reconnect (P1)

- On socket disconnect, mark player `connected: false`, start grace timer (e.g. 30s).
- Notify opponent (`opponent:disconnected`).
- If reconnect within grace (same session token), resume. Else `status: abandoned`,
  opponent notified, remaining player may exit / forfeit is recorded.

## 7. Server Authority & Anti-Cheat

- All win/draw/legality decisions happen on the server via the shared engine.
- Client rendering may be optimistic but is reconciled to server broadcasts.
- Turn ownership enforced by `socketId ↔ playerSlot` mapping in the room.
- Room IDs unguessable; joining requires the exact ID; full rooms reject extra joins.

## 8. Error Handling

- Illegal move → server emits `move:rejected` `{ reason }`, no state change.
- Join full/expired room → `join:error` `{ code }`; client shows friendly screen.
- AI failure/timeout → fallback to a random legal move; log + alert.
- Redis unavailable → dev falls back to in-memory; prod fails the request loudly.

## 9. Observability

- Structured logs per room event (create/join/move/over/abandon).
- Metrics: concurrent rooms, moves/sec, AI compute time histogram, join success rate.
- Health endpoint `GET /healthz`.

## 10. Testing Strategy

- **Engine unit tests (Vitest):** exhaustive win/draw detection, legal-move
  generation, illegal-move rejection for both games. Property tests where cheap.
- **AI tests:** Tic-Tac-Toe Hard must never lose and must win/draw optimally
  (solved game); Connect Four Hard beats a random player ≥ 95%. Difficulty
  monotonicity: Hard ≥ Medium ≥ Easy in head-to-head win rate.
- **Server/integration:** room lifecycle, turn enforcement, reconnect.
- **E2E (Playwright):** two browser contexts play a full PvP game via a shared link;
  AI game start-to-finish.

## 11. Security & Privacy

- No auth in v1; identity is ephemeral per session. Optional display name only.
- No PII stored. Rooms TTL-expire.
- **Rate limiting — reuse the existing in-house rate limiter** (do not build one).
  Docs: https://rate-limiter-seven.vercel.app/getting-started. Configuration deferred
  (tracked as MPG-021). Surfaces to protect once wired: `POST /api/rooms` (per-IP) and
  inbound socket events `join` / `move` (per-connection / per-room). Open integration
  questions to resolve against the docs: form factor (Express/Socket.IO middleware vs
  service), whether it can share our Redis, arbitrary-key limiting, and fail-open vs
  fail-closed behavior.
- Standard hardening: helmet headers, input validation on all socket payloads,
  CORS locked to the app origin.

## 12. Deployment (v1)

- Single region. Backend as a container (Fly.io / Render / a small VM). Redis managed
  or co-located. Static frontend on a CDN/host (Vercel/Netlify/Cloudflare Pages).
- Socket.IO sticky sessions if we run >1 backend replica (or use the Redis adapter).

## 13. Risks & Mitigations

| Risk                               | Mitigation                                                               |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Connect Four Hard AI too slow      | Depth-limit + alpha-beta + move ordering; cache; bitboard rep if needed. |
| Socket scaling / sticky sessions   | Socket.IO Redis adapter; single node for launch.                         |
| Reconnect complexity               | Ship P1; degrade gracefully (abandon) if out of scope for launch.        |
| Scope creep (accounts, more games) | Framework is game-agnostic; hold the line on v1 Non-Goals.               |
