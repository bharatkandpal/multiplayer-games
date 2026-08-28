# ADR 0004 — Lightweight identity, durable sessions & the social write model

**Status:** Accepted
**Date:** 2026-08-28
**Deciders:** Bharat (lead) + staff-architect
**Decision lens:** One identity + one write boundary that all three social features share,
without hardcoding accounts or a second write path
**Related:** [ADR 0003](0003-durable-persistence.md) (the store this writes to),
[ADR 0002](0002-realtime-games.md) (server-side score re-simulation),
MPG-018 (reconnect grace), MPG-016 (live-room invite)

---

## Context

ADR 0003 adopts Postgres and decides *what* store backs the leaderboard, sessions and
durable link sharing. This ADR decides the **connective tissue** those three features
share, which is heavy enough to stand alone:

1. **Who owns a durable record** with no accounts (leaderboard entry, saved result, share
   link)?
2. **When** does ephemeral room state get promoted into a durable record (the write
   boundary), and **what** is persisted?
3. **What "session" even means** — the word is overloaded across the draft (§C) and MPG-054.
4. How this reconciles with **MPG-018**'s "same session token" reconnect grace and
   **MPG-016**'s ephemeral invite link, so we don't grow two identity systems or two
   link systems.

## Decision

### 1. Disambiguate "session" — three things, named

The draft (§C-1) conflated three concepts. We name them and keep them distinct:

| Term (used from here on) | What it is | Where it lives |
| --- | --- | --- |
| **Session token** | an opaque, long-lived, per-visitor **identity** handle (no login) | issued by server; stored client-side |
| **Game-session record** (`GameResult`) | a durable, finished-game record promoted from a room | Postgres (ADR 0003) |
| **History** ("my games") | a read view listing a visitor's past `GameResult`s | derived query, by session token |

MPG-054 delivers all three; the noise in the term is resolved by never again saying
"session" unqualified.

### 2. One lightweight identity: the session token (unifies MPG-018)

There is **one** identity primitive: an **opaque, unguessable session token** (same
posture as `roomId`), issued by the server on first visit, stored client-side
(httpOnly cookie preferred, with a readable mirror where the client needs the id;
implementer's call), long-lived (rolling ~1 year), carrying **no PII**. It is:

- the **owner key** for every durable record (leaderboard entries, saved results, share
  links) — records are attributed to the *token*, never to the display name;
- **the** value MPG-018 means by "same session token" for reconnect grace — we do **not**
  invent a second token. MPG-018 *consumes* the token this ADR defines. (Reconnect grace
  itself remains a Redis/room concern; the token is just the stable handle across sockets.)
- the seam to real accounts later: Phase-4 accounts (MPG-028) add a `token → account` claim
  so a returning visitor can adopt their existing history — an upgrade over ADR 0003's
  tables, not a migration.

**Display name** is self-declared, non-unique, light-profanity-checked (PRD §10). Because
ownership binds to the token, name collisions and trivial impersonation don't corrupt
attribution (Q-B3): two "Sam"s are two tokens; a copied name owns nothing.

### 3. The write boundary: promote on game-over, not on create

The room stays **ephemeral in Redis through play** (unchanged). The server writes a durable
**`GameResult`** to Postgres **once, on `game:over`** — the promotion point. Rationale:

- Writing on create/first-move would litter the store with abandoned half-games and put a
  durable write on the room hot path. Game-over is the natural, low-frequency, meaningful
  commit point.
- **Abandoned** games (MPG-018) are also recorded, as an `abandoned`/forfeit outcome, so
  standings and forfeit stats stay honest — the same single write boundary, a different
  terminal status. No second path.

This keeps the split clean: **Redis = live room, Postgres = the record of what happened.**

### 4. What persists (Q-C4)

- **Always:** the result summary — `gameId`, seats snapshot (kind/level/displayName/team),
  outcome (winner/draw/abandoned + reason), duration, `createdAt`, owner token(s),
  optional `eventId`.
- **Move / input log:** **persist it.** For turn-based it's a tiny move list; for real-time
  (ADR 0002) it's the per-tick input log the controller already records. It's cheap at our
  scale and unlocks two things we're committing to: **replay** (the durable share in §6) and
  the **re-sim audit trail** behind ADR 0002 anti-cheat. Logs follow their parent result's
  retention (ADR 0003 §4).

### 5. Leaderboard trust & shape (the write side that identity gates)

- **One feature, two ranking metrics**, behind a `metric` discriminator — *not* two
  features. Real-time games rank by **numeric score** (natural fit, ADR 0002); turn-based
  games rank by **W/L/D standings** (win rate / points). Same table shape, same store, same
  screens. Ship the **real-time numeric leaderboard first** (ADR 0002 already built the
  `onRunComplete({ gameId, score, seed })` + re-sim seam); turn-based standings is a
  fast-follow reusing the identical `LeaderboardRepo`.
- **Only server-validated outcomes are written** (ADR 0002 guardrail, ADR 0003 §4):
  - real-time score submissions carry `{ gameId, seed, inputLog, runId }`; the server
    **re-simulates with the shared module** and writes only if the recomputed score matches;
  - turn-based standings derive from the **server-authoritative `game:over`** — there is no
    client score submission to trust at all.
- **Dedupe / replay resistance:** each result carries a unique `runId` (seed + owner +
  nonce); the write is **idempotent** on `runId` (unique constraint), so a replayed or
  double-submitted run can't double-count.

### 6. Link sharing: keep MPG-016 ephemeral; MPG-056 is NEW durable sharing (resolves Q-D1)

The draft's biggest ambiguity. Resolution: **they are two different links, both kept.**

- **MPG-016 stays the ephemeral live-room invite** — a capability URL to a Redis `room`,
  inherently dies with the room's TTL. **Unchanged by this work.**
- **MPG-056 is a new *durable* share link** — an unguessable token in a `share_link` row
  (ADR 0003) that resolves to a **persisted target**: a **result card**, its **replay**
  (from the stored move/input log, §4), or a **leaderboard view** (a saved gameId + filter).
  It outlives any room because it points at Postgres, not Redis.

Design of the durable link:

- **Capability-in-URL:** unguessable token → server lookup of the target (same posture as
  `roomId`); no enumeration, no capability data encoded in the URL beyond the opaque token.
- **Access:** anyone-with-the-link, **read-only**. Optional **expiry**; **revocable** by the
  owning session token. Event-scoped links inherit the event's retention/purge (ADR 0003 §4).
- We commit to exactly these kinds — **result, replay, leaderboard**. Sharing an arbitrary
  live "session" beyond the MPG-016 invite is explicitly out of scope.

## Consequences

**Positive**

- One identity primitive across reconnect (MPG-018), ownership, and sharing — no parallel
  token systems; a clean later upgrade to accounts.
- One write boundary (game-over promotion) — Redis and Postgres concerns stay separated;
  no durable writes on the room hot path.
- Leaderboard is one feature with two metrics; anti-cheat is a straight reuse of the
  ADR-0002 re-sim seam plus DB idempotency.
- Link sharing stops being ambiguous: MPG-016 (ephemeral invite) and MPG-056 (durable
  result/replay/leaderboard) are cleanly separated and both justified.

**Negative / risks (and mitigations)**

- *A long-lived client token is soft identity — clearing storage loses history.* → Accepted
  for a no-accounts POC; the Phase-4 account claim path is the durable fix; a "forget me"
  action (ADR 0003 §4) makes the softness a feature for privacy.
- *Persisting move/input logs grows storage.* → Tiny at our scale; retention-bounded; pays
  for replay + audit, both of which we're committing to.
- *Two link kinds could confuse users/devs.* → They're surfaced differently (invite a
  friend to play **now** vs. share **what happened**); documented in API_SPEC and the task
  ACs.
- *Impersonation via copied display names.* → Ownership binds to token, not name;
  attribution is uncorrupted (§2).

## Revisit triggers

- **Accounts/auth (MPG-028)** arriving → add `account_id` + the `token → account` claim;
  reconsider token lifetime and server-side session storage.
- A need to **share a live, in-progress** game durably (beyond MPG-016's ephemeral invite)
  → reopen the write boundary (promote-on-create) and access model.
- Abuse/spam on public leaderboards or share links → add rate limits (MPG-021), moderation,
  or gated access — the owner-scoped, revocable design leaves room for this.
- Cross-device history becoming a hard requirement before accounts → revisit token portability.
