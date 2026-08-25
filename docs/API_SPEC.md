# API Specification

**Status:** Draft v0.1 · **Related:** [TDD.md](TDD.md), [ARCHITECTURE.md](ARCHITECTURE.md)

Two surfaces: a small **REST/HTTP** API for room creation & health, and a
**WebSocket (Socket.IO)** event contract for real-time play. All game-outcome
decisions are server-authoritative.

---

## 1. Shared Types

```ts
type GameId = 'connect4' | 'tictactoe';
type Difficulty = 'easy' | 'medium' | 'hard';
type Slot = number;        // 1..N (POC: 1..2)

type Result =
  | { status: 'in_progress' }
  | { status: 'win'; winner: Slot }
  | { status: 'draw' };

// Move payloads are game-specific:
type Connect4Move = { column: number };     // 0..6
type TicTacToeMove = { cell: number };       // 0..8
type Move = Connect4Move | TicTacToeMove;

// A seat is a human or a bot; there is no room-level "mode".
type SeatConfig =
  | { slot: Slot; kind: 'human'; self?: boolean; displayName?: string }  // self = creator's seat; else open/joinable
  | { slot: Slot; kind: 'bot'; difficulty: Difficulty };

type PublicSeat = {
  slot: Slot;
  kind: 'human' | 'bot';
  difficulty?: Difficulty;     // bot seats
  displayName?: string;
  team?: number;
  open: boolean;               // human seat awaiting a join
  connected: boolean;
};

type PublicRoom = {
  roomId: string;
  gameId: GameId;
  status: 'waiting' | 'active' | 'finished' | 'abandoned';
  turn: Slot;
  state: unknown;              // engine state (board)
  seats: PublicSeat[];
};
```

---

## 2. REST API

Base path: `/api`

### `POST /api/rooms`
Create a room with a **seat configuration**. The same endpoint covers every experience —
vs-bot, link-share, and watch — by varying `seats`.

**Request** (link-share example: you + an open seat)
```json
{
  "gameId": "connect4",
  "seats": [
    { "slot": 1, "kind": "human", "self": true, "displayName": "Bharat" },
    { "slot": 2, "kind": "human" }
  ]
}
```

Other configs use the same shape:
```jsonc
// vs a Hard bot
"seats": [ {"slot":1,"kind":"human","self":true}, {"slot":2,"kind":"bot","difficulty":"hard"} ]
// watch: Medium vs Hard
"seats": [ {"slot":1,"kind":"bot","difficulty":"medium"}, {"slot":2,"kind":"bot","difficulty":"hard"} ]
```

**Response `201`**
```json
{
  "roomId": "a1B2c3D4e5F6",
  "gameId": "connect4",
  "inviteUrl": "https://app.example.com/connect4/room/a1B2c3D4e5F6",  // present if any open human seat
  "yourSlot": 1,          // the creator's seat (self); omitted for all-bot watch rooms
  "status": "waiting"      // "active" if no open human seats
}
```

**Validation:** `seats` must match the game's supported seat count (POC games: exactly 2),
slots unique and 1..N, bot seats require `difficulty`, at most one `self` human seat.

**Errors:** `400` invalid gameId/seats/difficulty · `429` rate-limited.

### `GET /api/rooms/:roomId`
Lightweight lookup (used before joining to show a friendly state).
- `200` → `PublicRoom`
- `404` room not found / expired
- Returns `status: "waiting"` if a guest slot is open.

### `GET /healthz`
`200 { "status": "ok" }` for liveness/readiness.

### `GET /metrics` (internal)
Prometheus-style metrics (concurrent rooms, AI compute histogram, etc.).

---

## 3. WebSocket API (Socket.IO)

Connection: client connects, then emits `join`. All events are JSON. Server
validates every payload; malformed input → `error` event, no state change.

### 3.1 Client → Server

| Event | Payload | Purpose |
|-------|---------|---------|
| `join` | `{ roomId, displayName? }` | Join a room (host reconnect or guest join). |
| `move` | `{ roomId, move }` | Propose a move (server validates turn + legality). |
| `rematch:request` | `{ roomId }` | Ask to play again with same opponent/room. |
| `rematch:accept` | `{ roomId }` | Accept a pending rematch (PvP). |
| `leave` | `{ roomId }` | Leave the room. |

### 3.2 Server → Client

| Event | Payload | Meaning |
|-------|---------|---------|
| `joined` | `{ room: PublicRoom, yourSlot: Slot }` | Join accepted (assigned to next open human seat). |
| `join:error` | `{ code, message }` | `ROOM_FULL` \| `NOT_FOUND` \| `EXPIRED`. |
| `game:start` | `{ room: PublicRoom }` | All open human seats filled; play begins. |
| `game:update` | `{ room: PublicRoom, lastMove }` | New authoritative state after a move. |
| `move:rejected` | `{ reason }` | `NOT_YOUR_TURN` \| `ILLEGAL_MOVE` \| `GAME_OVER`. |
| `game:over` | `{ room: PublicRoom, result: Result }` | Terminal state. |
| `opponent:disconnected` | `{ graceMs }` | Opponent dropped; reconnect window open. |
| `opponent:reconnected` | `{}` | Opponent came back within grace. |
| `room:abandoned` | `{ reason }` | Opponent didn't return / room closed. |
| `rematch:pending` | `{ from: Slot }` | A rematch was requested. |
| `error` | `{ code, message }` | Generic protocol/validation error. |

### 3.3 Bot seats (server-driven)
- Bot seats are never sockets. When the turn advances to a bot seat, the server runs the AI
  runner at *that seat's* `difficulty`, applies the move after an optional pacing delay, and
  emits `game:update`. For all-bot (watch) rooms the loop self-drives, emitting one paced
  `game:update` per move so watchers can follow. No client `move` is involved for bot seats.

### 3.4 Turn & auth rules
- A socket is bound to a human `Slot` at `join`. `move` is rejected unless
  `room.turn === socket.slot`, that seat is `human`, and the room is `active`.
- Only sockets bound to open human seats may join; once all human seats are filled, extra
  joins get `ROOM_FULL`. All-bot rooms accept read-only watchers (no seat).

---

## 4. Example: Full PvP Exchange

```
Host:  POST /api/rooms {gameId:'connect4', seats:[{slot:1,kind:'human',self:true},{slot:2,kind:'human'}]} -> {roomId, inviteUrl, yourSlot:1}
Host:  ws.emit('join', {roomId})              -> 'joined' {youAre:1}
Guest: opens inviteUrl, ws.emit('join', {roomId}) -> 'joined' {youAre:2}
Server: broadcast 'game:start'
Host:  ws.emit('move', {roomId, move:{column:3}})
Server: validate -> apply -> broadcast 'game:update' {turn:2, lastMove}
Guest: ws.emit('move', {roomId, move:{column:3}})
...
Server: broadcast 'game:over' {result:{status:'win', winner:1}}
Either: ws.emit('rematch:request') -> other 'rematch:pending' -> 'rematch:accept' -> 'game:start'
```

---

## 5. Versioning & Conventions

- All events namespaced; additive changes preferred. Breaking changes bump a
  `protocolVersion` sent in the connection handshake.
- Timestamps in epoch ms. IDs are opaque strings. No trailing-slash sensitivity.
