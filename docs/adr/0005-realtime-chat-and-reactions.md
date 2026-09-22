# ADR 0005 — In-game realtime chat & emoji reactions

**Status:** Accepted
**Date:** 2026-08-28
**Deciders:** Bharat (lead) + staff-architect
**Decision lens:** Add a social realtime layer without a second socket, a durable-chat
liability, or an unbounded watch-scale fan-out
**Related:** [ADR 0002](0002-realtime-games.md) (room channel, server authority),
[ADR 0003](0003-durable-persistence.md) (durable store — deliberately _not_ used here),
[ADR 0004](0004-identity-and-social-writes.md) (session token = sender identity),
MPG-011/013 (Socket.IO room + broadcast), MPG-019 (display names), MPG-021 (rate limiter)

---

## Context

MPG-057 adds an **in-game chat overlay** and **live emoji reactions** over the board.
Both are realtime, room-scoped social features layered on the existing multiplayer core.
Two calls carry real design weight — **persistence** and **moderation/safety** — and two
realtime concerns (**transport semantics** and **fan-out at the north-star watch scale of
100–200**) need pinning down. The rest is UX-DoD craft the implementer owns.

The surface is a **company/HR event** platform (north-star): watch-mode audiences,
spectators reacting to a big-screen game. That framing makes anti-abuse and fan-out
first-class, not afterthoughts.

### Forces (ranked)

1. **Reuse the room's realtime plane.** We already have an authoritative Socket.IO room
   channel (ADR 0002, MPG-013). Chat/reactions must ride it — not open a second socket or
   a second authority.
2. **Watch-scale fan-out must stay bounded.** 100–200 reactors must not produce 200
   messages/toasts per event; the socket and UI cost must be independent of audience size.
3. **Chat is a moderation + privacy liability the moment it's durable.** A persisted,
   replayable transcript on an HR surface means retention, redaction, and "deleted messages
   must not resurrect in a shared replay" — a materially bigger commitment than the value.
4. **Identity is already solved** — the ADR-0004 session token binds a sender; no new auth.
5. **Server stays authoritative** — order and timestamps are assigned server-side; clients
   never define message order or trust their own clocks (consistent with ADR 0002).

## Decision — persistence: **ephemeral** (chat _and_ reactions)

**Chat and reactions are ephemeral. They live only in the room's realtime plane and are
NOT written to the ADR-0003 durable store.** `GameResult` carries **no transcript**; there
is no chat table; reactions are decorative bursts with nothing to persist. This is the
load-bearing call, so the alternatives are on the record:

| Option                                                                                                                                                        | Verdict                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Ephemeral** — relayed live; optional short **Redis ring buffer** (last N messages in room state, TTL'd) for reconnect/late-join context; dies with the room | **Chosen**                             |
| **Durable** — chat/reactions attached to `GameResult`, replayable via an MPG-056 share link                                                                   | **Rejected for now** (Revisit trigger) |

**Why ephemeral wins:** chat is conversational and transient; a durable transcript adds a
retention/redaction/moderation burden (force #3) far exceeding its value, and it would
resurrect deleted content inside shared replays — a privacy hazard on an HR surface.
Reactions are decorative confetti with no artifact worth storing. Keeping both ephemeral
holds MPG-057 **entirely off the ADR-0003 durable path**: no schema, no repository, and
**no dependency on MPG-056**. A late joiner / reconnecting player may see the last **N**
messages from a **TTL'd ring buffer in the existing Redis room state** — still ephemeral,
no durable write, no PII beyond the transient room.

## Decision — transport (Q1/Q2)

Ride the **existing Socket.IO room channel** (ADR 0002 / MPG-013). No second socket, no
second authority.

- **Scope:** per-room, available to **everyone attached to the room — players and
  spectators/watchers** (north-star). Never assume 2 participants; the channel is designed
  for watcher fan-out from day one. POC (1v1, no spectators yet) is the two players, but the
  design is seat-count-agnostic like everything else.
- **Client→server intents:** `chat:message { roomId, text }`, `reaction:send { roomId, emojiId }`.
- **Server is authoritative:** validates, assigns a **monotonic order + server timestamp**,
  attributes to the sender's **session token** (+ optional display name), then broadcasts
  `chat:new` / `reaction:burst` to the room. Clients never define order or trust client clocks.

### Sender identity (Q4 — confirmed)

Sender = the **ADR-0004 session token** (the owner binding), with an **optional display
name** (MPG-019). **No PII.** Rate-limit, client-mute, and (later) report/moderation all key
off the session token, not the display name — so a copied name can't dodge a limit or a mute.

## Decision — reaction fan-out at watch scale (Q6)

Two layers keep cost independent of audience size:

- **Server-side aggregation.** The server **coalesces** reactions over a short tick
  (~250–500ms) into a single aggregated `reaction:burst` broadcast — `{ emojiId: count }`
  for the window — instead of one broadcast per reaction. 200 reactors in a tick → **one**
  frame, not 200 messages.
- **Server-side rate cap** per session token + per room (via MPG-021) bounds inbound volume
  before aggregation.
- **Client-side coalescing + bounded render.** The client renders a **capped** number of
  floating particles per burst regardless of `count` magnitude (scale intensity / show
  "+N"), and honors `prefers-reduced-motion` (reduce particles or substitute a static count
  badge). Reaction bursts are **decorative and `aria-hidden`** — they never flood aria-live.

Chat is similarly rate-limited but **not** aggregated (each message is distinct); the client
batches announcements (see UX ACs) to avoid aria-live flooding.

## Decision — moderation / safety posture (Q5)

Company/HR framing → anti-abuse is in-scope, sized POC-vs-later:

**In for POC:**

- **Rate-limit chat and reactions** via the **existing rate limiter (MPG-021)** — reuse,
  do not build — keyed per session token + per room, on the `chat:message` / `reaction:send`
  socket events (the surfaces MPG-021 already names for `join`/`move`).
- **Fixed server-known emoji palette only** — the server rejects unknown `emojiId`s, so
  reactions can't smuggle arbitrary emoji/text/markup.
- **Light profanity mask** on chat text (same posture as the PRD §10 display-name check) +
  a **length cap** and payload validation (TDD §11 input-validation already mandates this).
- **Client-side mute** — hide messages/reactions from a given sender token locally (cheap,
  local, no server state).

**Deferred to event mode (north-star; with MPG-027 spectators / MPG-028 events):**

- **Report/flag → organizer moderation** (server-side blocklist, per-event mute/kick,
  moderation queue). This is where durable moderation state would live if ever needed.
- Stronger/server-authoritative profanity, per-event chat enable/disable, slow-mode.

## Consequences

**Positive**

- Reuses the existing room socket + server authority — additive, no new transport or store.
- **Zero durable-chat liability**: no transcript retention/redaction problem, no
  deleted-message-resurrection in shared replays; MPG-057 stays off the ADR-0003 path.
- Fan-out cost is **bounded and independent of audience size** (server aggregation + capped
  client render), fit for the 100–200 watch target.
- Identity/rate-limit/mute all reuse the ADR-0004 token and MPG-021 limiter — no new primitives.

**Negative / risks (and mitigations)**

- _No chat history after the room expires._ → Intended; a TTL'd Redis ring buffer covers
  reconnect/late-join; durable transcript is a deliberate non-goal (revisit trigger).
- _Light profanity filter is bypassable._ → Accepted for POC; report/organizer-moderation is
  the event-mode answer; rate-limit + client-mute blunt spam meanwhile.
- _Aggregation adds a small server tick + latency to reactions._ → ~250–500ms is
  imperceptible for decorative confetti and is the price of watch-scale safety.
- _Chat aria-live could flood screen readers._ → Batched/polite announcements + reactions
  `aria-hidden`, captured as UX-DoD ACs on the task.

## Guardrails

1. **One socket, one authority** — chat/reactions ride the room channel; the server assigns
   order/timestamp; clients never define order (ADR 0002).
2. **Ephemeral only** — no chat/reaction rows in the ADR-0003 store; `GameResult` carries no
   transcript; the ring buffer is TTL'd room state.
3. **Sender = session token** — every limit, mute, and (later) report keys off the token,
   not the display name.
4. **Reactions are decorative** — `aria-hidden`, reduced-motion-aware, and bounded in render
   count regardless of aggregated magnitude.
5. **Reuse MPG-021** for rate limiting; do not build a limiter.

## Addendum (CHAT-020) — private rooms via secret-derived channels

Private chat rooms must not add durable state (guardrail 2 above) or a service that
gameplay could come to depend on (CLAUDE.md offline pillar). So privacy is a **capability**,
not a stored password:

- A private room's real Ably channel is `chat:p-<hmac>`, where `<hmac>` is a keyed
  `HMAC-SHA256(serverKey, roomId + "\n" + secret)` (32 hex chars). The `serverKey` is
  `CHAT_PRIVATE_ROOM_KEY`, falling back to the resolved Ably API key. Public rooms keep the
  plain `chat:<roomId>` channel, so existing links are unaffected.
- Both chat endpoints derive the channel from the `(roomId, secret)` the caller supplies and
  **only ever scope the subscribe-only token to that one channel.** A right secret → the same
  channel everyone else got; a wrong/absent secret → a _different_, empty channel. There is no
  server-side secret check, hence no store, no membership registry, nothing to be "down."
- The secret rides in the request body only. It never enters the URL — a share link carries at
  most a `?p=1` hint that tells the opener to prompt for the secret (shared out-of-band). The
  client holds it in `sessionStorage` for the tab.
- **Tradeoff:** because the server can't distinguish a wrong secret from an empty room, a
  mistyped secret silently isolates you rather than erroring. This is the accepted price of a
  stateless private room, surfaced in the UI ("if it looks empty, re-check the secret").

The security boundary is the **token scoping**, not the channel name's secrecy: a client can
never subscribe to a channel its token wasn't scoped to, however it learned the name.

## Revisit triggers

- A hard requirement to **replay chat/reactions inside a shared game** (MPG-056) → reopens
  durability; would need per-message moderation retention + redaction (deleted must not
  resurrect) and a durable store design under ADR 0003 — a bigger commitment, not a tweak.
- **Event mode** (MPG-027/028) landing → promote report/flag + organizer moderation from
  deferred to in-scope; consider durable moderation/audit state then.
- Reaction/chat volume outgrowing single-node aggregation → move coalescing behind the
  Socket.IO Redis adapter / a fan-out worker (same scaling path as ADR 0001/ARCHITECTURE §7).
- Abuse that light client-side filtering can't hold → server-authoritative moderation earlier.
