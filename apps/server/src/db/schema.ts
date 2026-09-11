/**
 * Drizzle table definitions — the durable persistence schema.
 *
 * Five aggregates:
 *   sessions          – lightweight, no-PII identity tokens
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata"),
  },
  (t) => [uniqueIndex("sessions_username_lower_idx").on(sql`lower(${t.username})`)],
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
    unique("leaderboard_upsert_key").on(t.gameId, t.eventId, t.timeBucket, t.ownerToken),
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
