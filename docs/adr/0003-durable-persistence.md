# ADR 0003 — Durable Persistence (Postgres + Drizzle)

**Status:** Accepted (2026-08-28)

## Context

The platform needs durable storage for game results, leaderboard standings, session
tokens, and shareable links. Redis stays ephemeral (room state only). ADR 0001 deferred
Postgres "until accounts/stats arrive" — this ADR introduces it decoupled from accounts.

## Decision

1. **Postgres is the single durable system-of-record.** Redis remains ephemeral-only
   (room TTL, pub/sub). No polyglot storage.

2. **Drizzle ORM** for schema definition, query building, and TS-native migrations.
   Driver: `postgres` (postgres.js) — ESM-native, no native bindings.

3. **Repository port pattern** (`apps/server/src/store/ports.ts`): four interfaces
   (`SessionRepo`, `ResultRepo`, `LeaderboardRepo`, `ShareLinkRepo`) bundled in a
   `Store` type. Two adapters:
   - **Postgres** (`store/pg/`) — production, requires `DATABASE_URL`.
   - **In-memory** (`store/memory/`) — dev + Vitest, zero external dependencies.

4. **Adapter selection by environment:** `DATABASE_URL` set → Postgres; absent →
   in-memory. No config file. Vitest always gets in-memory.

5. **Owner-scoped keys via `owner_token`** FK → `sessions.token`. All data is tied to
   an opaque, no-PII session token. "Forget me" cascades through this key.

6. **`run_id` for idempotency:** every game-result write carries a unique `run_id`.
   Unique constraint prevents double-writes. Leaderboard upserts reference `run_id` to
   avoid re-counting.

7. **`event_id` is nullable:** scopes results/leaderboard to a company event when
   present. Global when null. Additive for the north-star event mode.

8. **No durable I/O in `packages/engine`.** The engine stays pure. All persistence
   lives in `apps/server`.

## Schema (four tables)

- `sessions` — lightweight identity (token, created_at, last_seen_at, metadata)
- `game_results` — every completed/abandoned game (runId, gameId, gameFamily, status,
  seats snapshot, move log, duration, score, owner_token, event_id)
- `leaderboard_entries` — per-game standings with `metric` discriminator
  (`score` | `wld`), composite upsert key `(gameId, eventId, timeBucket, ownerToken)`
- `share_links` — unguessable tokens → result/replay/leaderboard; optional expiry,
  revocable by owner

## Retention & privacy

- **90-day rolling:** delete game results older than 90 days + expired share links.
- **Event purge:** delete all leaderboard entries for an event.
- **"Forget me":** delete all data across every repo for a session token.

## Consequences

- Local dev requires Docker for Postgres (`docker compose up -d`), or falls back to
  in-memory (no persistence between restarts).
- Contract tests run in-memory — CI does not need a database.
- Future: Supabase, Neon, or Railway replaces the local container in production;
  only `DATABASE_URL` changes.
