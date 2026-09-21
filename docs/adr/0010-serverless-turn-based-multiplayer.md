# ADR 0010 — Turn-based multiplayer over the serverless API

**Status:** Proposed (2026-09-16)
**Date:** 2026-09-16
**Deciders:** Bharat (lead)
**Decision lens:** Let PvP work without a long-running process, because every game we
ship multiplayer for is turn-based — and a container is a dependency the rest of the
product no longer has.
**Builds on:** ADR 0001 (pure shared engine), ADR 0002 (turn-based vs real-time
families), ADR 0003 (durable persistence), ADR 0009 (split-topology API).
**Blocks / reshapes:** MPG-023 (deploy), MPG-067 (horizontal scale).

---

## Context

Multiplayer today requires a long-running Node process. Not because the games need one,
but because room state lives in a `Map`. From `apps/server/src/rooms/types.ts:3`:

> Rooms are ephemeral: kept in-memory (or, later, Redis — MPG-067), never in the durable
> Postgres store.

and `RoomManager.ts:71`:

```ts
private readonly rooms = new Map<string, Room>();
```

That was a sound call when it was made — rooms are ephemeral, Postgres was scoped to
results/leaderboard/sessions, and Socket.IO needed a process anyway. But the ground has
moved underneath it in two ways.

**1. Every multiplayer game we have is turn-based.** ADR 0002 split the catalogue into
two families and was explicit about the second: real-time arcade games are **solo** ("One
player, no seats, no turn order"). So the entire real-time family has no multiplayer
requirement at all, and the entire multiplayer catalogue — Tic-Tac-Toe, Connect Four, and
their siblings — consists of games where a player makes one discrete move and then waits.
The continuous, low-latency, frame-accurate transport we're paying for is being used to
carry roughly one message per player per several seconds.

**2. Everything else is architected to deploy without a container.** ADR 0009 and MPG-086
moved production HTTP to Vercel functions against Neon; `apps/api` owns sessions,
leaderboard, results, share, events and card images. The container's remaining exclusive
job is rooms + sockets. Shipping and paying for a persistent process to serve that one
feature is a large fixed cost for the least-used surface, and it puts PvP on a different
availability footing than the rest of the product.

> **Correction (2026-09-18).** This paragraph originally read "already deploys without a
> container" — stated in the present tense, and false. At the time of writing, **no
> deployed function had ever executed a line of our code**: both `apps/api` and the
> `apps/web` unfurl shim 500'd on every invocation with `ERR_MODULE_NOT_FOUND`, because
> Vercel transpiles a function's entry file without rewriting its imports and our packages
> export raw `.ts`. Deploys were green throughout, since `vercel build` + `vercel deploy`
> never invoke anything. Fixed by pre-bundling the handlers (MPG-148), with a post-deploy
> smoke request now gating the workflow.
>
> The argument below is unaffected — it rests on the _architecture_ of the serverless half,
> which was sound, not on its deployment having worked. But the distinction matters enough
> to record: this ADR was drafted on an assumption nobody had tested, and "CI is green" was
> what made it feel safe to assume.

**What is already in our favour.** The transport seam we would need was built deliberately
and has held. `RoomManager.ts:5`:

> This module knows nothing about Socket.IO; `roomHandlers.ts` wires it to the transport.
> That keeps the transport swappable.

It's true where it counts. `RoomManager.ts`, `gameState.ts` (`applyPlayerMove`) and
`botRunner.ts` are all transport-free; socket references are confined to the three wiring
modules `roomHandlers.ts`, `rematchHandler.ts` and `moveHandler.ts`. That last one is the
caveat worth naming: `moveHandler.ts` is not purely a transport adapter — it also owns
result persistence and the bot hand-off, so porting it means separating those concerns
rather than swapping a transport under them. But the rules half of multiplayer — the part
that is hard and correctness-critical — has no transport dependency to unpick.

**So the blocker is state, not transport.** `store/ports.ts` exposes eight repos
(sessions, identities, results, leaderboard, shareLinks, events, reports, variants) and no
room concept. That absence is the work.

### What genuinely does not survive the move

Four behaviours currently ride on in-process timers and an in-process event loop. They are
not equally hard, and it's worth being precise about which is which.

| Behaviour                                                   | Survives?    | Why                                                                                                                                                 |
| ----------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| TTL expiry (`setInterval` sweep, `RoomManager.ts:86`)       | Yes          | `expiresAt` is already a field on `Room`. Check it lazily on read; the sweeper is a cleanup optimization, not a correctness mechanism.              |
| Bot pacing (`botRunner.ts`, 200–400ms randomized reply)     | Yes          | This is a _feel_ concern ("so bot replies don't feel instant") and belongs on the client. Server computes immediately; the client animates.         |
| Disconnect grace (`graceTimers`, 30s → `room:abandoned`)    | Re-expressed | There is no connection to lose, so "disconnected" is redefined as "hasn't polled within N seconds". Polling supplies that liveness signal for free. |
| Opponent notification (`EventEmitter` → `io.to(room).emit`) | **No**       | This is the real loss. See below.                                                                                                                   |

**Push is the actual cost.** Turn-based does not mean latency-insensitive: the _opponent_
still needs to learn promptly that you moved. Without a socket that becomes polling or
SSE. A five-minute Connect Four at a 2s poll is on the order of 150 requests per player
where sockets carried perhaps 20 messages total. That is a bandwidth and
function-invocation bill, not a correctness problem — but it is the thing being bought,
and it should be named rather than discovered.

### The correctness hazard this introduces

`applyPlayerMove` mutates the room in place — `room.state`, `room.turn`, `room.moveLog`,
and on a terminal result `room.status`. In a single Node process the event loop serializes
every move through one thread; that is an **invisible mutex** the current handler silently
depends on.

Move the same logic to concurrent function invocations over a shared row and two
simultaneous writes both read, both apply, and the last write wins. A move disappears.

This is fixable, but it must be deliberate, because turn-based rules make it _rare_: only
one seat is legally to-move, so the window is narrow and the bug would pass every manual
test and every happy-path integration test, then bite occasionally in production. It is
exactly the class of defect that is cheap to design against and expensive to diagnose.

## Decision

**Make durable, serverless-servable rooms the primary path for turn-based multiplayer. Keep
the Socket.IO container as an optional accelerator, not a requirement.**

Five parts.

### 1. `RoomRepo` in the durable store

Add a ninth repo to `store/ports.ts`, with both a `pg` and a `memory` implementation, so
the existing contract-test harness covers it and local/offline development is unaffected.

Rooms stay conceptually ephemeral — TTL'd, swept, never user-visible history. Durable
storage is an implementation of ephemerality, not a contradiction of it.

Three fields of `Room` need reshaping on the way in:

- `Seat.socketId` — transport-specific. Replace with `lastSeenAt: number`, which is what
  the grace rule actually wants to know.
- `RematchState.proposedBy: Set<Slot>` — not JSON-serializable. Persist as a sorted array.
- `state: unknown` — already opaque to the room manager; persists as JSONB. The engine is
  pure (ADR 0001), so re-reading state and re-applying is safe by construction.

### 2. Optimistic concurrency on every move

`Room` gains a monotonic `version`. Applying a move is read → apply in memory →
`UPDATE … WHERE id = $id AND version = $expected`. Zero rows updated means someone else
moved first: reload and re-validate rather than retry blindly, since the correct response
to "the board changed under you" is usually `NOT_YOUR_TURN`, not a replay of the move.

`applyPlayerMove` keeps its current signature and in-place mutation — it operates on a
freshly-loaded `Room`, and the version guard is applied by the caller at persist time. The
pure core does not learn about concurrency.

The client's move request carries an **idempotency key** so a retry after a timeout cannot
double-apply. `Room.runId` already establishes this pattern for result persistence.

### 3. HTTP move endpoint + a long-poll subscription

- `POST /api/rooms/:id/moves` — validate, apply, persist, return the new `PublicRoom`.
  The mover gets their result synchronously, which is the fast path and the one that
  matters most for perceived responsiveness.
- `GET /api/rooms/:id?since=:version` — returns immediately if `version > since`,
  otherwise holds the request open up to ~25s (inside the `maxDuration: 15`→ raised
  budget in `apps/api/vercel.json`) and returns on change or timeout. The client
  re-issues. Long-poll over SSE because it degrades more predictably through proxies and
  needs no connection-state machine on the client.

Turn ownership stays server-derived — from the session token's bound seat, never from
client input. That invariant (`gameState.ts:18`) is unchanged and non-negotiable.

### 4. Bots resolve inline

When a human's move leaves the turn with a bot seat, the bot's move is computed and
applied **within the same request**, before responding. `pickMove` is pure and stateless;
the only thing `botRunner` owns is scheduling, which is precisely the part serverless
cannot keep. The randomized reply delay moves to the client as an animation concern.

This removes the `setTimeout` chain entirely and makes bot moves atomic with the human
move that provoked them — which also closes a latent interleaving question the current
design handles only by virtue of being single-threaded.

### 5. The container becomes optional

`apps/server` keeps Socket.IO and keeps working. When present, it is a latency
optimization: the same `RoomRepo`, with socket push instead of long-poll. When absent,
clients fall back to polling and multiplayer still works.

The client picks its path by feature detection at room-join, not by build-time
configuration, so the fallback is exercised rather than theoretical.

## Alternatives considered

**Keep container-only (status quo).** Lowest effort and best latency. Rejected because it
keeps a persistent process as a hard dependency of the one feature that most needs to be
reachable from anywhere, and it keeps PvP on a different availability and deployment
footing than everything else we ship.

**Redis-backed rooms (MPG-067).** Solves the shared-state half and is the right answer for
socket _load_. Rejected as the primary move because it swaps one always-on service for
another — the deployment shape is unchanged. Worth noting that this ADR does not compete
with MPG-067 so much as reduce its urgency: if rooms are durable and moves are versioned,
horizontal scale stops being a room-state problem.

**A hosted WebSocket provider (Ably / Pusher / Vercel's own).** Keeps true push without a
container. Rejected for now as premature: it adds a vendor, a second identity/auth surface,
and a cost model, to buy latency that turn-based play does not need. Reconsider if polling
cost or perceived lag measures badly — this decision is deliberately reversible in that
direction, since §3's subscription endpoint is the only thing that would change.

**Client-authoritative / peer-to-peer.** Rejected outright. It forfeits server-authoritative
legality, which is the anti-cheat foundation the whole seat model rests on.

## Consequences

**Positive**

- PvP no longer requires a container. The full product — SPA, functions, database — becomes
  deployable as static assets plus serverless, which is also the shape MPG-023 is already
  building toward for everything else.
- Rooms survive a deploy. Today a container restart mid-game silently destroys every live
  room; durable rooms make a rolling deploy a non-event.
- Reconnect gets simpler and more honest: state is fetched, not replayed from a socket's
  recollection.
- The invisible-mutex dependency becomes an explicit, tested version guard — a latent
  correctness assumption turned into an enforced invariant.
- Aligns with the offline/degradation pillar in spirit: a dead accelerator degrades to a
  slower path, not to an absent feature.

**Negative / watch-outs**

- **Polling cost is real and recurring.** It should be measured before this is Accepted,
  not after. The poll interval is a tunable with a direct cost consequence.
- **Perceived latency on the opponent's side goes up** by up to one poll interval on the
  fallback path. Long-poll keeps this small in the common case, but it is a regression
  against sockets and should be validated against the UX latency budget
  (`docs/UX_PRINCIPLES.md`) rather than assumed acceptable.
- **Rematch is the messiest port.** `rematchHandler.ts` currently re-joins live sockets
  across two rooms in a deliberate two-pass dance. Without sockets it becomes a stored
  `newRoomId` the clients discover on their next poll — simpler, but it is a genuine
  rewrite of the trickiest handler, not a mechanical translation.
- **Two transports means two code paths to keep honest.** Mitigated by both sitting on the
  same `RoomRepo` and the same `applyPlayerMove`, and by making the client feature-detect
  so the fallback is always live — but it is still more surface than one path.
- **Function duration limits** bound the long-poll window; `maxDuration` in
  `apps/api/vercel.json` is currently 15s and would need raising.

**Scope**

- Applies to the **turn-based** family only. ADR 0002's real-time arcade games are solo and
  are untouched by this decision; nothing here should be read as a claim that real-time
  multiplayer could work the same way — it could not, and if we ever add it, the container
  (or a push provider) is the answer.
- Chat, reactions and voice (ADR 0005, 0006) are **out of scope** and remain
  container/provider-backed. They are genuinely latency-sensitive in a way moves are not,
  and they already degrade to absence by design.

**What would move this to Accepted**

1. A measured poll-cost estimate at a realistic concurrent-game count.
2. Opponent-side latency on the long-poll path checked against the UX latency budget.
3. A decision on whether the container stays deployed at all, or is kept only as a local
   development convenience.

---

## Amendment (2026-09-21) — push via Ably; state stays on Neon

This amendment resolves two of the three open questions above by naming a concrete free-tier
topology, and corrects one factual assumption §3 was built on. It supersedes the transport
half of §3 and §5; the state/concurrency/bots halves (§1, §2, §4) are unchanged and are what
the `RoomRepo` below implements.

### Correction to §3 — the long-poll window §3 assumed does not exist on the free tier

§3 proposed holding a subscription open **~25s** by "raising `maxDuration` from 15s." On
**Vercel Hobby, function duration is hard-capped at 10s** — not a default, a ceiling. The
25s long-poll was never available on the tier we deploy to. Any polling fallback must
therefore hold ≤ ~9s and re-issue (short long-poll), which strictly worsens the
invocation/CPU math §3 flagged as the thing to measure. This is the trigger the "hosted
WebSocket provider" alternative reserved: *"reconsider if polling cost or perceived lag
measures badly."* It measures badly a priori, so we take that path — with the free-tier
economics that made it "premature" in 2026-09-16 no longer holding.

### Decision — **Ably** is the opponent-notification hop

The one behaviour §-context marked **No** ("opponent notification is the real loss") is
filled by Ably, a browser-facing pub/sub with an HTTP publish endpoint. Free-tier headroom
(checked 2026-09-21, confirm before scaling): **6M messages/mo, 200 peak concurrent
connections, 200 concurrent channels, 500 msg/s.** A turn-based game is ~20 messages, so the
binding limit is **200 concurrent connections (~100 simultaneous 2-player games)** — ample at
hobby scale; the message cap is ~3× more headroom than needed and never close.

Ably was chosen over Supabase Realtime (the first-drafted candidate) **not** for the larger
message quota — both cap concurrent connections at 200, which is what actually binds us, so
the message headroom is irrelevant to our workload. It was chosen for two reasons that do
matter: (1) **token-capability auth** scopes a client's subscription to exactly `room:<id>`
via a short-lived token our move function mints next to the seat check it already does —
keeping the per-room authorization invariant in our code rather than re-expressing it as RLS
in a separate system; and (2) **connection-state recovery** — Ably resumes a dropped
connection and replays missed messages, which serves the reconnect story directly on flaky
networks. Since state stays on Neon (below), the notify vendor is standalone either way, so
there is no consolidation reason to prefer Supabase.

Crucially this keeps the container-optional spirit of the ADR while dropping the container
*and* the free-tier-impossible long-poll:

- **State of record stays on Neon.** No new state vendor; Upstash Redis (considered as the
  MPG-067 alternative) is **not** adopted. The `RoomRepo` below is a ninth Postgres repo
  alongside the existing eight, so the contract-test harness and in-memory dev adapter cover
  it for free (§1's requirement, unchanged).
- **The push channel carries a notification, never authority.** See "ping-then-fetch" below.
  This is what preserves the seat-model invariant §3 called non-negotiable.
- **Degrade to short-poll, feature-detected at join** (§5's principle, retained): Ably
  unreachable → client short-polls the `GET` endpoint → game still fully playable. This is
  the offline/degradation pillar applied to the accelerator, exactly as the original §5 framed
  the container.

### `RoomRepo` — the ninth repo (implements §1)

Honoring the store's "no engine types leak here" rule (`ports.ts:8`), the persisted record
uses `gameId: string` / `state: unknown` and is distinct from the in-memory `Room`
(`rooms/types.ts:61`); the room layer maps between them. The three reshapings §1 mandated are
baked in: `Seat.socketId` → `lastSeenAt`, `RematchState.proposedBy` → sorted array,
`state` → JSONB. Adds the `version` §2 requires.

```ts
export interface RoomRecord {
  readonly id: string;
  readonly gameId: string;              // plain string — no @mpg/engine import
  readonly status: string;              // "waiting" | "active" | "finished" | "abandoned"
  readonly turn: number;                // 1-based slot
  readonly seats: unknown;              // Seat[] w/ lastSeenAt instead of socketId, as JSONB
  readonly state: unknown;              // opaque engine board, JSONB (engine is pure — safe to re-read)
  readonly moveLog: unknown;            // MoveLogEntry[]
  readonly rematch: unknown;            // { proposedBy: number[]; newRoomId?: string } | null
  readonly runId: string;              // idempotency key for result persistence (existing pattern)
  readonly version: number;             // monotonic — the optimistic-concurrency guard (§2)
  readonly createdAt: Date;
  readonly expiresAt: Date;             // checked lazily on read; sweeper is cleanup-only (§-context table)
}

export interface NewRoomRecord {
  readonly id: string;
  readonly gameId: string;
  readonly status: string;
  readonly turn: number;
  readonly seats: unknown;
  readonly state: unknown;
  readonly runId: string;
}

export interface RoomRepo {
  /** Create a room at version 1. */
  create(room: NewRoomRecord): Promise<RoomRecord>;

  /** Load by id. Returns undefined if absent or already past `expiresAt` (lazy TTL). */
  findById(id: string): Promise<RoomRecord | undefined>;

  /**
   * Compare-and-set the mutable room fields. Applies iff the stored version still
   * equals `expectedVersion`, bumping it by one. Zero rows updated → someone moved
   * first: the caller reloads and re-validates rather than retrying (§2). This is
   * the invisible-mutex-made-explicit that §2 requires.
   */
  applyMove(
    id: string,
    expectedVersion: number,
    next: Pick<RoomRecord, "status" | "turn" | "seats" | "state" | "moveLog" | "rematch">,
  ): Promise<RoomRecord | undefined>;

  /** Touch a seat's liveness (replaces socket presence; feeds the disconnect-grace rule). */
  touchSeat(id: string, slot: number, lastSeenAt: Date): Promise<void>;

  /** Best-effort cleanup of expired rooms. Correctness rests on lazy TTL, not this. */
  deleteExpired(): Promise<number>;
}
```

`RoomRepo` joins the `Store` bundle (`ports.ts:454`) as `readonly rooms: RoomRepo`.

### The notify contract — ping-then-fetch (preserves server authority)

1. `POST /api/rooms/:id/moves` — validate against the session's bound seat, `applyMove`
   with the version guard, resolve any bot seat inline (§4). The **mover** gets the new
   `PublicRoom` synchronously (the fast path §3 kept).
2. On a successful move the function **publishes one message via Ably's REST endpoint** to
   channel `room:<id>` with a minimal hint — `{ v: <newVersion> }`, nothing authoritative.
   Fire-and-forget: no held connection server-side, so the 10s cap is irrelevant, and a
   failed publish degrades to the opponent's poll — never blocks or fails the move (offline
   pillar).
3. The **opponent's** browser, subscribed to `room:<id>`, wakes on the ping and does an
   **authenticated `GET /api/rooms/:id`** to fetch the server-derived `PublicRoom`. The
   broadcast payload is never trusted as state; turn ownership stays server-derived from the
   session token's bound seat (`gameState.ts:18`). A stale/duplicate/forged ping costs at most
   one wasted GET.

### Watch-outs this introduces

- **200 concurrent connections is the real ceiling** — instrument it; it caps concurrent
  live games well before messages or bandwidth do. The 6M-message quota is ~3× our need and
  never the limiter.
- **A second auth surface** — a client needs an Ably token to subscribe. Our move/join
  function issues a short-lived token whose capability is scoped to exactly `room:<id>` for
  the seated player, so a client can't subscribe to a room it isn't seated in. This is the one
  cost from the original "hosted provider" rejection that free-tier pricing does *not* erase,
  and it is accepted deliberately — token-capability scoping keeps the authorization decision
  in our function, beside the seat check.
- **Two write targets in one request path** (Neon commit, then Ably publish) — ordering is
  commit-then-publish, and publish failure is swallowed, so Neon is always the source of truth
  and Ably is only ever an accelerator.

### What still stands from the original decision

§1 (durable `RoomRepo`), §2 (optimistic `version` + idempotency key), §4 (bots resolve
inline) are unchanged. What changes: §3's long-poll becomes Ably push with short-poll
fallback, and §5's "container as accelerator" becomes "Ably as accelerator" — the container is
no longer needed even as the fast path. Open question #3 (does the container stay deployed) is
thereby answered: **no — local dev convenience only.**
