# ADR 0003 — Durable persistence & data store

**Status:** Accepted
**Date:** 2026-08-28
**Deciders:** Bharat (lead) + staff-architect
**Decision lens:** Cross the ephemeral→durable line without foreclosing the event north-star
**Supersedes:** the assumed-Postgres line in TDD §2 / ROADMAP Phase 4 (was never argued)
**Related:** [ADR 0001](0001-tech-stack.md) (TS both ends, pure engine),
[ADR 0002](0002-realtime-games.md) (server-side score re-simulation),
[ADR 0004](0004-identity-and-social-writes.md) (identity & the write model that builds on this)

---

## Context

The next feature set — **leaderboard** (MPG-055), **sessions** (MPG-054) and **durable
link sharing** (MPG-056) — all cross a line the POC deliberately hasn't crossed: **state
that outlives a single room's Redis TTL.** Today:

- **Redis** holds only **ephemeral** room state (`room:{roomId}`, JSON + TTL, no PII),
  behind an adapter with an in-memory fallback for dev (TDD §5, ARCHITECTURE §2).
- The docs **assume** Postgres "when accounts/stats/leaderboards arrive" (TDD §2,
  ROADMAP Phase 4) — but this was never argued in an ADR, and it **bundles** the store
  with accounts. PRD §10 still open: _"persist finished-game results, or fully ephemeral?"_

Two things need deciding on the record: **(1)** what durable store we adopt, and **(2)**
**when** it enters — specifically, whether durable persistence must wait for full accounts.

### What the three features actually need to store (decide against this, not in the abstract)

| Entity                                                                                          | Shape                                                 | Access pattern                                                    |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| **Game result** (gameId, seats snapshot, outcome, duration, timestamp, optional move/input log) | relational: result ↔ seats ↔ game, optional child log | append on game-over; read by id; list by owner                    |
| **Leaderboard entry** (gameId, metric, score/W-L, owner, displayName, optional eventId, bucket) | relational aggregate                                  | **read-heavy, ranked, filtered**: top-N per game / window / event |
| **Session / identity** (opaque token, displayName, createdAt)                                   | key + a little                                        | lookup by token; join to owned results/entries                    |
| **Share link** (token → target result/replay/leaderboard, expiry, revoked)                      | relational reference                                  | lookup by token; revoke by owner                                  |

This is **relational-shaped**: a handful of entities with clear foreign keys and
**ranked, filtered aggregate reads** (the leaderboard). Volume is tiny — even the
north-star company event is 100–200 concurrent people (ADR 0001 north-star check); a
leaderboard is hundreds to low-thousands of rows, not millions.

### Forces (ranked by weight)

1. **One store that serves all four entities** — results, leaderboard, sessions, links —
   keeps operational surface minimal for a small team.
2. **Ranked/filtered leaderboard queries** (`ORDER BY score`, `WHERE gameId/eventId`,
   time windows) must be first-class, not bolted on.
3. **Transactional integrity for score writes** — exactly-once, dedupe replayed
   submissions (the anti-cheat boundary in ADR 0002 depends on this).
4. **Swappable behind an adapter** — mirror the Redis/in-memory pattern so the store can
   change and dev/test need no running database (ADR 0001 guardrail #2 generalized).
5. **Decouple durability from auth** — we can persist results with a _lightweight_ identity
   (ADR 0004) long before we build accounts/login.
6. **Scale is modest** — nothing here needs horizontal document-store scale-out.

## Options Considered

| Option                                                        | Ranked queries                             | One store for all 4                           | Txn integrity         | New infra         | Verdict                                           |
| ------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------- | --------------------- | ----------------- | ------------------------------------------------- |
| **Postgres (SQL) — system of record**                         | ✅ native (`ORDER BY`, indexes, windows)   | ✅                                            | ✅                    | one managed DB    | **Chosen**                                        |
| **Reuse Redis as the _durable_ store** (AOF/RDB, sorted sets) | ✅ ZSET is a great leaderboard _primitive_ | ⚠️ results/links/sessions become ad-hoc blobs | ❌ weak multi-key txn | none              | Rejected as SoR (see §Redis)                      |
| **Document store** (Mongo/Dynamo/Firestore)                   | ⚠️ ranked/filtered + joins get awkward     | ⚠️                                            | ⚠️                    | new dependency    | Rejected — solves a scale problem we don't have   |
| **Hybrid now** (Postgres SoR + Redis ZSET leaderboard cache)  | ✅                                         | ✅                                            | ✅                    | two stores + sync | Rejected _for now_ (premature; a revisit trigger) |

## Decision

**Adopt PostgreSQL as the single durable system-of-record** for all four entities, behind
a repository adapter that mirrors the Redis/in-memory pattern. **Introduce it with the
first durable feature — not with accounts.**

### 1. Postgres, one store, not polyglot (yet)

At our scale a single indexed Postgres serves the read-heavy leaderboard trivially
(top-N over hundreds/thousands of rows is an index scan). Adding Redis sorted-sets as a
second source of truth buys nothing today and introduces a cache/SoR consistency problem
(Q-A5). We keep **one** durable store. Redis stays exactly what it is: the ephemeral,
TTL'd room cache. A Redis ZSET **read-cache in front of** Postgres is an explicit, later,
measurement-driven option — see Revisit triggers — never a second system of record.

### 2. Introduce durability **now**, ahead of accounts (the key call)

We **overturn the bundling** of Postgres with accounts. Durable persistence enters when
the first durable feature ships (MPG-053 → the foundation under 054/055/056), gated behind
the adapter so nothing in the current ephemeral POC changes until then. Identity for these
features is the **lightweight session token** in ADR 0004 — _not_ login. This resolves the
PRD open question: **we persist finished-game results** (server-authoritative outcomes
only), we do **not** stay fully ephemeral.

### 3. Adapter boundary (mirrors Redis/in-memory)

Data access lives **server-side** (durable I/O must never enter the pure `packages/engine`
— ADR 0001 guardrail #1). Define **repository ports** in `apps/server/src/store/` next to
the Redis adapter, one per aggregate:

```ts
// apps/server/src/store/ports.ts (sketch — server-only)
interface ResultRepo {
  save(r: GameResult): Promise<void>; // idempotent on runId (see ADR 0004)
  byId(id: string): Promise<GameResult | null>;
  listByOwner(sessionToken: string, page: Page): Promise<GameResult[]>;
}
interface LeaderboardRepo {
  submit(e: LeaderboardEntry): Promise<void>; // idempotent; server-validated only
  top(query: {
    gameId: GameId;
    metric: Metric;
    eventId?: string;
    window?: TimeWindow;
    limit: number;
  }): Promise<RankedRow[]>;
  rankFor(owner: string, query: LeaderboardQuery): Promise<RankedRow | null>;
}
interface ShareLinkRepo {
  create(l: ShareLink): Promise<void>;
  resolve(token: string): Promise<ShareTarget | null>;
  revoke(token: string, owner: string): Promise<void>;
}
interface SessionRepo {
  upsert(s: SessionRecord): Promise<void>;
  byToken(t: string): Promise<SessionRecord | null>;
}
```

Two adapters, exactly like Redis has:

- **Postgres adapter** (prod/staging) — the real implementation.
- **In-memory / SQLite adapter** (dev + Vitest) — so tests and local dev need **no running
  database**, matching the Redis in-memory fallback. (SQLite if we want SQL parity in tests;
  in-memory maps if we want zero deps — implementer's call, both satisfy the port.)

**Tooling:** use a **TypeScript-native, type-safe query layer with lightweight migrations**
(recommended: Drizzle; Kysely + a migration runner is an acceptable equivalent). This keeps
"TypeScript both ends" honest for data access and gives versioned, reviewable migrations.
A heavyweight ORM is not warranted for four tables. _(Tool choice is a low-cost, revisitable
implementation detail, not the load-bearing part of this ADR.)_

DTO/record **types** that cross the client/server boundary (result summary, ranked row,
share target) are plain types and may live in a shared spot referenced by `API_SPEC`; they
**must not** pull I/O into `packages/engine`.

### 4. Privacy & retention (posture shift — decide it here)

The POC's "no PII" posture becomes **"minimal, self-declared, no accounts."**

- The only new persisted identity is an **opaque session token** (not PII) and a
  **self-declared display name** (light profanity check, per PRD §10). No emails, no auth
  credentials, no third-party identifiers.
- **Retention defaults:** global/per-game leaderboard entries and results retained **90
  days** rolling by default; **event-scoped** data (rows carrying an `eventId`) is deleted
  on **event end + 30-day grace**, and an organizer can purge an event on demand (HR
  requirement). Move/input logs follow their parent result's lifetime.
- **Delete/forget path:** a returning player can clear their own history/entries via their
  session token (a "forget me" action); per-event purge for organizers. These are product
  requirements captured on MPG-054/055, enabled by owner-scoped keys in the schema.
- Data lives in a single region (matches TDD §12). Backups follow the managed Postgres
  provider's defaults; document the retention window there.

## Consequences

**Positive**

- One durable store serves results, leaderboard, sessions and share links — smallest
  operational surface for a small team; ranked/filtered queries are native SQL.
- The adapter boundary keeps the store swappable and lets **all tests + local dev run with
  no database**, exactly like the Redis fallback.
- Durability is **decoupled from auth**: we ship social features on a lightweight token now,
  and a real accounts system (Phase 4, MPG-028) becomes an _upgrade_ over the same tables,
  not a rewrite.
- Transactional, idempotent writes give the ADR-0002 anti-cheat boundary a place to enforce
  exactly-once, server-validated scores.

**Negative / risks (and mitigations)**

- _A new stateful dependency to run, migrate and back up._ → Managed Postgres (same
  provider posture as managed Redis, TDD §12); versioned migrations; in-memory/SQLite
  adapter means CI and laptops carry no DB.
- _Crossing the "no PII" line at all._ → Held to a minimal, self-declared, no-accounts
  posture with explicit retention + delete paths (§4); nothing verified/sensitive is stored.
- _Mixing durable and ephemeral concerns in one server._ → They stay physically separated:
  Redis = ephemeral rooms (unchanged), Postgres = durable records; the write boundary
  (game-over promotion) is defined in ADR 0004, not smeared across the room hot path.
- _Postgres could later strain on a leaderboard hot path._ → Not at 100–200 concurrent; if
  measured, add a Redis ZSET read-cache in front (revisit trigger), keeping Postgres SoR.

## Guardrails to protect the bet

1. **Durable I/O never enters `packages/engine`.** The engine stays pure (ADR 0001 #1);
   repositories are server-only.
2. **The store is an interface**, like the transport (ADR 0001 #2) and the Redis store —
   two adapters (Postgres, in-memory/SQLite), swappable, DB-free tests.
3. **Redis stays single-purpose** — ephemeral room cache only; never promoted to durable SoR.
4. **Leaderboard writes accept only server-validated outcomes** (ADR 0002 re-sim); the DB
   enforces idempotency (unique `runId`) so replays can't double-count.

## Revisit triggers

- A **measured** leaderboard read hot path Postgres can't serve economically → introduce a
  Redis ZSET **read-cache** in front (polyglot as an optimization, Postgres still SoR).
- Durable write/read volume growing past what a single managed Postgres handles (far beyond
  the 100–200-concurrent north-star) → reconsider partitioning or a document store for logs.
- Full **accounts/auth** (MPG-028) arriving → extend these tables with an `account_id` and a
  token→account claim path (planned in ADR 0004), not a new store.
- A hard **compliance** requirement (real PII, SSO) → revisit retention, encryption, region.
