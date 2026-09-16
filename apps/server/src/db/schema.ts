/**
 * Drizzle table definitions — the durable persistence schema.
 *
 * Six aggregates:
 *   sessions          – lightweight, no-PII identity tokens
 *   identities        – claimed, durable handles a session can upgrade into (MPG-091)
 *   game_results      – durable record of every completed/abandoned game
 *   leaderboard_entries – per-game, per-scope standings (score or W/L/D)
 *   share_links       – unguessable tokens resolving to a result, replay, or leaderboard
 *   analytics_events  – the product-truth funnel log (MPG-097)
 *
 * Owner-scoped via `owner_token` FK → sessions.token.
 * `event_id` is nullable — scopes to a company event when present.
 */

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    // Nullable — most sessions have never picked a username (MPG-077).
    // Uniqueness is case-insensitive, enforced via the functional index below.
    username: text("username"),
    // Nullable — set when a session is upgraded into a claimed, durable identity
    // (MPG-091). Many sessions (devices) may point at one identity. `set null` on
    // identity delete: losing the claim reverts the session to anonymous, it is
    // never orphaned to a dangling FK.
    identityId: uuid("identity_id").references((): AnyPgColumn => identities.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata"),
  },
  (t) => [
    uniqueIndex("sessions_username_lower_idx").on(sql`lower(${t.username})`),
    index("sessions_identity_idx").on(t.identityId),
  ],
);

// ---------------------------------------------------------------------------
// identities (MPG-091)
// ---------------------------------------------------------------------------

/**
 * A claimed, durable handle. A player plays anonymously on a session token;
 * claiming a handle mints an identity and links the current session to it. A
 * returning player on a new device re-links their session by presenting the
 * recovery code (device-key model — no passwords, no email, no OAuth).
 *
 *  - `handle` is case-insensitively unique (functional index below), moderated
 *    at the route via the same `moderateText("handle", …)` as usernames.
 *  - `recovery_code_hash` is the SHA-256 of the normalised recovery code. The
 *    plaintext code is shown to the player exactly once at claim time and never
 *    stored — the column authorises re-linking a session, nothing more, and a
 *    leak of this table cannot reveal a code.
 */
export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: text("handle").notNull(),
    recoveryCodeHash: text("recovery_code_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("identities_handle_lower_idx").on(sql`lower(${t.handle})`),
    index("identities_recovery_idx").on(t.recoveryCodeHash),
  ],
);

// ---------------------------------------------------------------------------
// game_results
// ---------------------------------------------------------------------------

export const gameResults = pgTable(
  "game_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: text("run_id").notNull().unique(),
    gameId: text("game_id").notNull(),
    gameFamily: text("game_family").notNull().default("turn-based"),
    eventId: text("event_id"),
    ownerToken: text("owner_token")
      .notNull()
      .references(() => sessions.token, { onDelete: "cascade" }),
    status: text("status").notNull(), // win | draw | abandoned | forfeit
    winnerSlot: integer("winner_slot"),
    score: integer("score"),
    seatsSnapshot: jsonb("seats_snapshot").notNull(),
    durationMs: integer("duration_ms"),
    moveLog: jsonb("move_log"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("game_results_owner_idx").on(t.ownerToken),
    index("game_results_game_event_idx").on(t.gameId, t.eventId),
    index("game_results_created_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// leaderboard_entries
// ---------------------------------------------------------------------------

export const leaderboardEntries = pgTable(
  "leaderboard_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: text("game_id").notNull(),
    metric: text("metric").notNull(), // score | wld
    eventId: text("event_id"),
    timeBucket: text("time_bucket"), // e.g. "2026-W35", "all-time"
    ownerToken: text("owner_token")
      .notNull()
      .references(() => sessions.token, { onDelete: "cascade" }),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    bestScore: integer("best_score"),
    totalGames: integer("total_games").notNull().default(0),
    runId: text("run_id"), // latest contributing run (idempotency)
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // `nullsNotDistinct` is load-bearing, not a detail (MPG-133). Two of these
    // four columns are nullable, and a plain UNIQUE treats NULL as distinct from
    // NULL — so for the *default* leaderboard (no event, no time bucket, which
    // is the common case) the constraint matched nothing, `onConflictDoUpdate`
    // never fired, and every submission inserted another row instead of
    // accumulating into the player's. The in-memory adapter keys on the string
    // "null" and always behaved correctly, which is why only a real Postgres run
    // could surface this.
    unique("leaderboard_upsert_key")
      .on(t.gameId, t.eventId, t.timeBucket, t.ownerToken)
      .nullsNotDistinct(),
    index("leaderboard_rank_idx").on(t.gameId, t.metric, t.bestScore),
  ],
);

// ---------------------------------------------------------------------------
// share_links
// ---------------------------------------------------------------------------

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    kind: text("kind").notNull(), // result | replay | leaderboard
    targetId: uuid("target_id").notNull(),
    ownerToken: text("owner_token")
      .notNull()
      .references(() => sessions.token, { onDelete: "cascade" }),
    eventId: text("event_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("share_links_owner_idx").on(t.ownerToken)],
);

// ---------------------------------------------------------------------------
// analytics_events (MPG-097)
// ---------------------------------------------------------------------------

/**
 * The funnel log — product truth, distinct from MPG-022's system health.
 *
 * Three shape decisions worth stating, because each is a constraint rather
 * than a preference:
 *
 *  1. **`owner_token` is the only identifier, and it cascades.** It is the same
 *     opaque no-PII token as everywhere else (ADR 0004), which is what makes
 *     k-factor and D1/D7 computable at all — you cannot count "how many new
 *     sessions did one share produce" without a stable anonymous id. It is an
 *     FK with `onDelete: cascade` so deleting a session erases its funnel trail
 *     too; analytics does not get to outlive the identity it describes.
 *  2. **`share_link_id`, never the share token.** The token IS the capability
 *     that authorizes reading a result, so copying it into an analytics row
 *     would duplicate a secret into a table read by reporting queries. The
 *     internal row id answers every funnel question the token would, and
 *     authorizes nothing.
 *  3. **`props` is bounded and non-identifying.** Small scalars only (see
 *     `analytics/events.ts`, which validates before anything reaches here).
 *     No URLs, no user agents, no free text.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ownerToken: text("owner_token")
      .notNull()
      .references(() => sessions.token, { onDelete: "cascade" }),
    gameId: text("game_id"),
    shareLinkId: uuid("share_link_id"),
    eventId: text("event_id"),
    props: jsonb("props"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Funnel counts are always "how many of event X in window W".
    index("analytics_events_name_created_idx").on(t.name, t.createdAt),
    // Retention (D1/D7) and per-session erasure both scan by owner.
    index("analytics_events_owner_idx").on(t.ownerToken, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// reports (MPG-092 slice 2 — report-a-name)
// ---------------------------------------------------------------------------

/**
 * A review queue for player-filed reports about authored content (usernames,
 * handles at L1/L2). A report hides nothing and blocks no one — it records a
 * concern for a human reviewer (MPG-103/104) to act on.
 *
 *  - `reporter_token` is the filing session, owner-scoped like every other
 *    table, and FK-cascaded so "forget me" erases a reporter's filings.
 *  - `target_id` is plain text, not an FK: targets are heterogeneous (a session
 *    for a username, an identity for a handle, later a variant), so it stores
 *    the reported surface's id uninterpreted — the reviewer resolves it.
 *  - `reason` is a bounded, optional, non-displayed note; validated at the route.
 */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // username | handle
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    reporterToken: text("reporter_token")
      .notNull()
      .references(() => sessions.token, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Per-session erasure ("forget me") and retention sweeps scan by reporter.
    index("reports_reporter_idx").on(t.reporterToken, t.createdAt),
    // A reviewer queue reads newest-first across the whole table.
    index("reports_created_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// variants (MPG-089 — save & share a customized game)
// ---------------------------------------------------------------------------

/**
 * A player-authored, saveable customization of a base game. At L1 this is
 * purely cosmetic (ADR 0007) — a named bundle of renderer-only option choices.
 *
 *  - `owner_token` is the authoring session, owner-scoped and FK-cascaded like
 *    every other aggregate so "forget me" erases a player's variants.
 *  - `cosmetics` is an **opaque, bounded, flat `string→string` JSON map**. The
 *    server does NOT interpret the option ids — the `CosmeticSchema` lives in
 *    `apps/web` per the FE/BE import boundary (a variant made on a newer client
 *    must round-trip through an older server untouched). A shape + size guard
 *    (`variants/cosmetics.ts`) keeps the column from being abused as arbitrary
 *    storage; it validates structure and bounds, never the *meaning* of an id.
 *  - `forked_from` is a nullable self-FK provisioned for lineage (MPG-099). No
 *    fork path ships at L1 — the column exists so forking is an additive route,
 *    not a migration. `set null` on parent delete: a fork outlives its origin.
 *  - `base_game_id` is a plain string (a registered game id), validated at the
 *    save route (MPG-089-b), not here — the store stays engine-agnostic.
 */
export const variants = pgTable(
  "variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ownerToken: text("owner_token")
      .notNull()
      .references(() => sessions.token, { onDelete: "cascade" }),
    baseGameId: text("base_game_id").notNull(),
    cosmetics: jsonb("cosmetics").notNull(),
    forkedFrom: uuid("forked_from").references((): AnyPgColumn => variants.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "My variants" and per-session erasure both scan by owner, newest-first.
    index("variants_owner_idx").on(t.ownerToken, t.createdAt),
    // Lineage lookups (MPG-099) walk children of a parent.
    index("variants_forked_from_idx").on(t.forkedFrom),
  ],
);
