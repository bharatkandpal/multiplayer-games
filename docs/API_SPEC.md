# API Specification

**Status:** Draft v0.1 · **Related:** [TDD.md](TDD.md), [ARCHITECTURE.md](ARCHITECTURE.md)

Two surfaces: a small **REST/HTTP** API for room creation & health, and a
**WebSocket (Socket.IO)** event contract for real-time play. All game-outcome
decisions are server-authoritative.

---

## 1. Shared Types

```ts
type GameId = "connect4" | "tictactoe";
type Difficulty = "easy" | "medium" | "hard";
type Slot = number; // 1..N (POC: 1..2)

type Result = { status: "in_progress" } | { status: "win"; winner: Slot } | { status: "draw" };

// Move payloads are game-specific:
type Connect4Move = { column: number }; // 0..6
type TicTacToeMove = { cell: number }; // 0..8
type Move = Connect4Move | TicTacToeMove;

// A seat is a human or a bot; there is no room-level "mode".
type SeatConfig =
  | { slot: Slot; kind: "human"; self?: boolean; displayName?: string } // self = creator's seat; else open/joinable
  | { slot: Slot; kind: "bot"; difficulty: Difficulty };

type PublicSeat = {
  slot: Slot;
  kind: "human" | "bot";
  difficulty?: Difficulty; // bot seats
  displayName?: string;
  team?: number;
  open: boolean; // human seat awaiting a join
  connected: boolean;
};

type PublicRoom = {
  roomId: string;
  gameId: GameId;
  status: "waiting" | "active" | "finished" | "abandoned";
  turn: Slot;
  state: unknown; // engine state (board)
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
  "inviteUrl": "https://app.example.com/connect4/room/a1B2c3D4e5F6", // present if any open human seat
  "yourSlot": 1, // the creator's seat (self); omitted for all-bot watch rooms
  "sessionToken": "...", // omitted for all-bot watch rooms (no seat to bind)
  "creatorToken": "...", // opaque; lets the creator watch-join over Socket.IO (see §3.0) — e.g. an
  // all-bot watch room has no seat/sessionToken to reconnect with
  "status": "waiting" // "active" if no open human seats
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

### `GET /api/leaderboard/:gameId` (MPG-055)

Top-N leaderboard entries for a game, plus the requesting session's own rank if listed.
Session-scoped (via `x-session-token` header / `mpg_session` cookie — see MPG-054).

**Query params**

- `metric` — `"wld"` (turn-based win/loss/draw, default) or `"score"` (real-time high score)
- `limit` — default `10`, max `50`
- `eventId?`, `timeBucket?` — scope to an event/leaderboard window

**Response `200`**

```json
{
  "entries": [
    {
      "id": "…",
      "gameId": "tictactoe",
      "metric": "wld",
      "eventId": null,
      "timeBucket": null,
      "ownerToken": "…",
      "wins": 3,
      "losses": 1,
      "draws": 0,
      "bestScore": null,
      "totalGames": 4,
      "runId": "…",
      "updatedAt": "2026-08-28T00:00:00.000Z"
    }
  ],
  "yourRank": 1 // 1-based; omitted if the caller isn't on the board
}
```

### `GET /api/leaderboard/:gameId/rank` (MPG-055)

Just the requesting session's own rank + entry (cheaper than fetching the full board — used
for the post-game rank preview). Same query params as above (minus `limit`).

**Response `200`** → `{ "rank": 3, "entry": LeaderboardEntry }` or `{ "rank": null }` if the
caller hasn't played this game (or has no session).

### `POST /api/leaderboard/:gameId/submit` (MPG-065)

Anti-cheat submit path for **real-time (score)** games (e.g. `floppy-birds`, `drunk-walk`).
Session-scoped — requires `x-session-token` header / `mpg_session` cookie. The server never
trusts the client's declared `score`: it re-simulates `{seed, inputLog}` through that game's
deterministic `RealtimeModule` (`createInitialState` → `tick` per input) and only accepts the
score if it equals `getScore(finalState)` **and** `isGameOver(finalState)` is `true`.

**Body**

```json
{
  "seed": 7,
  "inputLog": [{ "flap": false }, { "flap": false }],
  "runId": "client-generated-uuid",
  "score": 3,
  "eventId": null,
  "timeBucket": null
}
```

- `seed`, `inputLog`, `runId`, `score` — required. `inputLog` entries are opaque,
  game-specific input shapes (`I` in `RealtimeModule<S, I>`).
- `runId` — idempotency key; resubmitting an already-recorded `runId` is a no-op success
  (mirrors `GameResult`'s `runId` uniqueness), not a duplicate `bestScore` bump.
- `eventId?`, `timeBucket?` — same leaderboard scoping as the GET endpoints above.

**Response `200`** → `{ "ok": true, "entry": LeaderboardEntry }`, or on a duplicate `runId`,
`{ "ok": true, "duplicate": true, "entry": LeaderboardEntry | null }`.

**Errors**

- `400 { "error": "no_session" }` — no session token resolved
- `400 { "error": "INVALID_REQUEST" }` — missing/malformed `seed`/`inputLog`/`runId`/`score`
- `400 { "error": "UNKNOWN_GAME" }` — `:gameId` has no registered `RealtimeModule`
- `422 { "error": "SCORE_MISMATCH" }` — the replayed run's score and/or game-over state
  doesn't match the client's claim; nothing is written

### `POST /api/results` (MPG-131)

Persists a finished **local turn-based** game — vs-bot or hot-seat, the games that never
touch a room and so have no server-side result of their own. Room-backed games do NOT use
this: the server already wrote their result when it refereed the game, and hands each seat
its id over `game:result-saved` (§3.2).

Session-scoped — requires `x-session-token` header / `mpg_session` cookie. The client's
claimed **outcome is never trusted**: the server replays `moveLog` through that game's pure
`GameModule` (`createInitialState` → `applyMove` per entry) and derives `status`/`winnerSlot`
from its own final position. `applyMove` enforces turn order and legality itself, so a
forged log fails the replay rather than being written as fact. The same posture
`POST /api/leaderboard/:gameId/submit` takes for real-time runs.

**Body**

```json
{
  "runId": "client-generated-uuid",
  "gameId": "tictactoe",
  "moveLog": [
    { "slot": 1, "move": { "cell": 0 } },
    { "slot": 2, "move": { "cell": 3 } }
  ],
  "seatsSnapshot": [
    { "slot": 1, "kind": "human" },
    { "slot": 2, "kind": "bot", "difficulty": "medium" }
  ],
  "durationMs": 42000
}
```

- `runId` — idempotency key, client-minted so a retry after a network blip can't
  double-write. Stored namespaced (`local:<runId>`) so it can never collide with a room's
  server-minted key.
- `moveLog` — required, non-empty, max 500 entries. `move` is the game-native opaque shape
  (`M` in `GameModule<S, M>`); `slot` is the 1-based seat that played it.
- `seatsSnapshot` — required, exactly `playerCount` entries. Rebuilt field-by-field on the
  server (only `slot`/`kind`/`difficulty` survive), because it is echoed to strangers by
  `GET /api/share/:token`.
- `durationMs?` — optional.

**Deliberately writes no leaderboard entry.** A local game is played against a bot whose
difficulty the player chose, or against someone on the same sofa; ranking it alongside room
games would make the board meaningless. This route exists to give a finished local game
something a durable share link can point at (MPG-056), nothing more.

**Response `201`** → `{ "ok": true, "resultId": "…" }`, or on a repeat of the same `runId`,
`200 { "ok": true, "duplicate": true, "resultId": "…" }`.

**Errors**

- `400 { "error": "no_session" }` — no session token resolved
- `400 { "error": "INVALID_REQUEST" }` — missing/malformed `runId`/`gameId`/`moveLog`/`durationMs`,
  or a move log that is empty or over the 500-entry cap
- `400 { "error": "UNKNOWN_GAME" }` — `:gameId` has no registered `GameModule`
- `400 { "error": "INVALID_SEATS" }` — `seatsSnapshot` malformed, or not `playerCount` long
- `409 { "error": "RUN_ID_TAKEN" }` — that `runId` belongs to another session (deliberately
  not a peek at their result id)
- `422 { "error": "REPLAY_MISMATCH" }` — a move was illegal, out of turn, or played after
  the game ended; nothing is written
- `422 { "error": "GAME_NOT_OVER" }` — the replay reached a non-terminal position; only a
  finished game is worth a durable link

### `GET /api/session` (MPG-054)

Current (or newly-minted) session identity. Session-scoped via `x-session-token` header /
`mpg_session` cookie — the middleware mints a token on first contact if neither is present.

**Response `200`**

```json
{ "token": "…", "username": null, "createdAt": "2026-08-28T00:00:00.000Z" }
```

`username` is `null` until the session claims one via `POST /api/session/username` below.

### `DELETE /api/session` (MPG-054)

"Forget me" — erases all data owned by this session token (results, leaderboard entries,
share links, the session itself) and clears the cookie.

**Response `200`** → `{ "deleted": { "results": 2, "leaderboard": 1, "shareLinks": 0, "sessions": 1 } }`

### `GET /api/session/history` (MPG-054)

Paginated game results owned by this session, newest first.

**Query params:** `limit` (default `20`, max `100`), `offset` (default `0`).

**Response `200`** → `{ "results": GameResult[] }`

### `POST /api/session/username` (MPG-077)

Claim or update this session's display name. Names are unique **case-insensitively**
across all sessions.

**Request**

```json
{ "username": "bharat_k" }
```

**Validation:** 3–20 characters, alphanumeric plus `_`/`-` only.

**Response `200`** → `{ "token": "…", "username": "bharat_k" }`

Idempotent: re-posting the caller's own current username (in any casing) succeeds and
simply updates the stored casing — it is never treated as a collision with itself.

**Errors:**

- `400 { "error": "INVALID_USERNAME" }` — fails length/charset validation.
- `409 { "error": "USERNAME_TAKEN" }` — another session already holds this name
  (case-insensitive).

### `POST /api/events` (MPG-097)

Client-reported loop-analytics events. Session-scoped via `x-session-token`.

**Request**

```json
{
  "events": [
    {
      "name": "first_input",
      "occurredAt": 1788000071451,
      "gameId": "connect-four",
      "props": { "msSinceArrival": 3500, "viaShare": true }
    }
  ]
}
```

**Response `202`** → `{ "accepted": 1, "dropped": 0 }`

Three things are deliberate here:

- **Only client-reportable events are accepted.** `first_input` is the whole allowlist
  today. `result_saved`, `share_minted` and `share_opened` are recorded server-side where
  they happen; posting them here drops them silently rather than letting a browser inflate
  the share rate.
- **Unknown names and malformed props are dropped, not rejected.** They are counted in
  `dropped` and the call still returns `202` — a background flush has no UI to show an
  error to and no retry that would help. Only a structurally invalid body is a `400`.
- **`occurredAt` is honoured, within reason.** A batch can be delivered late, so the
  client stamps each event; a timestamp more than 6h stale or 5m in the future falls back
  to server-now rather than being dropped.

`props` values must be strings (≤64 chars), finite numbers, or booleans — at most 8 keys,
no nesting. That is a privacy boundary, not a size limit: it is what keeps URLs, user
agents and free text out of the table.

A `sendBeacon` flush on page teardown cannot set headers, so this route also accepts a
`text/plain` body carrying `sessionToken` alongside `events`.

**Errors:**

- `400 { "error": "INVALID_REQUEST" }` — `events` is missing or not an array.
- `413 { "error": "BATCH_TOO_LARGE", "max": 50 }` — more than 50 events in one request.

### `GET /healthz`

`200 { "status": "ok" }` for liveness/readiness.

### `GET /metrics` (internal)

Prometheus-style metrics (concurrent rooms, AI compute histogram, etc.).

---

## 3. WebSocket API (Socket.IO)

Connection: client connects, then emits `join`. All events are JSON. Server
validates every payload; malformed input → `error` event, no state change.

> **Implementation note (MPG-011):** room _lifecycle_ (create/join/leave/state) is
> implemented today under a `room:`-prefixed namespace — see §3.0 — rather than the
> bare `join`/`joined`/`leave` names in §3.1–3.2 below. Room creation is additionally
> available over Socket.IO (`room:create`), not just REST. §3.1–3.2's `join` and
> `move`/`game:*` events are the target contract for gameplay (MPG-012+) and are not
> yet implemented in that bare form (`move`/`game:*` themselves ARE implemented,
> unprefixed, per MPG-013 — see §3.2's note). **Flagged for staff-architect:**
> reconcile the two event namespaces (either prefix gameplay events with `room:` too,
> or drop the prefix from the lifecycle events) before MPG-012 locks in the gameplay
> wire format. The `rematch:*` events in this table have been superseded by §3.5
> (MPG-015, implemented) — see below.

### 3.0 Room lifecycle (implemented, MPG-011)

| Direction | Event          | Payload                                                                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | -------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C→S       | `room:create`  | `{ gameId, seats: SeatConfig[] }`                                      | Create a room (mirrors `POST /api/rooms`); creator's socket always joins the room's Socket.IO channel, whether or not `seats` gives it a `self` seat to hold (e.g. all-bot watch rooms).                                                                                                                                                                                                                                                      |
| C→S       | `room:join`    | `{ roomId, sessionToken?, seatIndex?, displayName? }`                  | Join (or reconnect to) a room. Omitted `sessionToken` mints a new one.                                                                                                                                                                                                                                                                                                                                                                        |
| C→S       | `room:leave`   | `{ roomId, sessionToken }`                                             | Leave the room.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| C→S       | `room:state`   | `{ roomId, creatorToken? }`                                            | Request the current `PublicRoom` snapshot. If `creatorToken` matches the room's creator credential, this socket is also (re-)joined to the room's broadcast channel — the only way to watch-rejoin an all-bot room (e.g. after a page refresh), since it holds no seat/`sessionToken`. A missing/wrong `creatorToken` is a silent no-op (snapshot still returned) — **not** "anyone with the roomId can watch" (that's the separate MPG-027). |
| S→C       | `room:created` | `{ room: PublicRoom, roomId, sessionToken?, yourSlot?, creatorToken }` | Reply to `room:create`, sent to the creator only. `creatorToken` is always present (see `room:state` above); `sessionToken`/`yourSlot` are omitted when this seat config gives the creator no seat (all-bot watch rooms).                                                                                                                                                                                                                     |
| S→C       | `room:updated` | `{ room: PublicRoom }`                                                 | Broadcast to everyone in the room on any seat/status change.                                                                                                                                                                                                                                                                                                                                                                                  |
| S→C       | `room:error`   | `{ code, message }`                                                    | `INVALID_PAYLOAD` \| `NOT_FOUND` \| `ROOM_FULL` \| `SEAT_TAKEN` \| `NOT_A_MEMBER` \| ...                                                                                                                                                                                                                                                                                                                                                      |

All four client→server events also accept a trailing Socket.IO ack callback
(`(response: { ok: true; data } | { ok: false; error }) => void`) for request/response
use, in addition to the broadcasts above.

### 3.1 Client → Server

| Event             | Payload                    | Purpose                                                          |
| ----------------- | -------------------------- | ---------------------------------------------------------------- |
| `join`            | `{ roomId, displayName? }` | Join a room (host reconnect or guest join).                      |
| `move`            | `{ roomId, move }`         | Propose a move (server validates turn + legality).               |
| `rematch:request` | `{ roomId }`               | _Superseded by `rematch:propose` — see §3.5._                    |
| `rematch:accept`  | `{ roomId }`               | _Superseded — see §3.5 (a 2nd `rematch:propose` IS the accept)._ |
| `leave`           | `{ roomId }`               | Leave the room.                                                  |

### 3.2 Server → Client

`opponent:disconnected`, `opponent:reconnected`, and `room:abandoned` below are
already implemented (MPG-011, driven by the room manager's disconnect-grace timer);
the rest of this table is the target contract for MPG-012.

| Event                   | Payload                                | Meaning                                           |
| ----------------------- | -------------------------------------- | ------------------------------------------------- |
| `joined`                | `{ room: PublicRoom, yourSlot: Slot }` | Join accepted (assigned to next open human seat). |
| `join:error`            | `{ code, message }`                    | `ROOM_FULL` \| `NOT_FOUND` \| `EXPIRED`.          |
| `game:start`            | `{ room: PublicRoom }`                 | All open human seats filled; play begins.         |
| `game:update`           | `{ room: PublicRoom, lastMove }`       | New authoritative state after a move.             |
| `move:rejected`         | `{ reason }`                           | `NOT_YOUR_TURN` \| `ILLEGAL_MOVE` \| `GAME_OVER`. |
| `game:over`             | `{ room: PublicRoom, result: Result }` | Terminal state.                                   |
| `game:result-saved`     | `{ roomId, resultId }`                 | **Per-seat, not broadcast** — see below.          |
| `opponent:disconnected` | `{ graceMs }`                          | Opponent dropped; reconnect window open.          |
| `opponent:reconnected`  | `{}`                                   | Opponent came back within grace.                  |
| `room:abandoned`        | `{ reason }`                           | Opponent didn't return / room closed.             |
| `rematch:pending`       | `{ from: Slot }`                       | _Superseded by `rematch:proposed` — see §3.5._    |
| `error`                 | `{ code, message }`                    | Generic protocol/validation error.                |

**`game:result-saved` (MPG-131).** Sent only to the individual socket of each human seat,
once the server's result write for that seat lands. `game:over` deliberately goes out first
and never waits on the database — the result screen is the moment the game ends — so the
persisted row's id follows separately. That id is what a durable share link is minted
against (`POST /api/share`), and it identifies a row owned by one session, which is why it
is never part of the room-wide broadcast. A seat that disconnected in between is simply not
told; its result is still persisted and readable via `GET /api/session/history`.

### 3.3 Bot seats (server-driven)

- Bot seats are never sockets. When the turn advances to a bot seat, the server runs the AI
  runner at _that seat's_ `difficulty`, applies the move after an optional pacing delay, and
  emits `game:update`. For all-bot (watch) rooms the loop self-drives, emitting one paced
  `game:update` per move so watchers can follow. No client `move` is involved for bot seats.

### 3.4 Turn & auth rules

- A socket is bound to a human `Slot` at `join`. `move` is rejected unless
  `room.turn === socket.slot`, that seat is `human`, and the room is `active`.
- Only sockets bound to open human seats may join; once all human seats are filled, extra
  joins get `ROOM_FULL`. All-bot rooms accept exactly one read-only watcher today: the
  room's creator (via its auto-join on `room:create`, or a later `room:state` presenting
  the room's `creatorToken` — see §3.0). Public multi-spectator links (anyone with the
  room ID) are the separately-tracked MPG-027, not yet implemented.

### 3.5 Rematch (implemented, MPG-015)

Only available once a room's `status` is `finished` (i.e. after `game:over`). Identifies the
proposing seat by `sessionToken`, the same way `room:join`/`room:leave` do — never a
client-declared `Slot`.

| Direction | Event              | Payload                    | Meaning                                                                                            |
| --------- | ------------------ | -------------------------- | -------------------------------------------------------------------------------------------------- |
| C→S       | `rematch:propose`  | `{ roomId, sessionToken }` | Propose a rematch. A 2nd occupied human seat proposing IS the accept — no separate "accept" event. |
| C→S       | `rematch:decline`  | `{ roomId, sessionToken }` | Decline a pending rematch; clears every proposal so far.                                           |
| S→C       | `rematch:proposed` | `{ from: Slot }`           | Broadcast to the room whenever a seat proposes.                                                    |
| S→C       | `rematch:declined` | `{ from: Slot }`           | Broadcast to the room when a seat declines.                                                        |
| S→C       | `rematch:start`    | `{ roomId }`               | Sent once every occupied human seat has proposed. `roomId` is a **freshly-created** room —         |
|           |                    |                            | same `gameId` + seat config (bot difficulties and human `sessionToken`s carried over), fresh       |
|           |                    |                            | engine state/move log. Sockets are auto-rebound into it server-side before this fires.             |
| S→C       | `rematch:error`    | `{ code, message }`        | `INVALID_PAYLOAD` \| `NOT_FOUND` \| `NOT_FINISHED` \| `NOT_A_MEMBER`.                              |

All client→server events also accept a trailing ack callback, matching §3.0's shape
(`{ ok: true; data } | { ok: false; error }`); `rematch:propose`'s ack `data` includes
`{ allProposed, newRoomId? }` for callers that don't want to wait on the broadcast.

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
