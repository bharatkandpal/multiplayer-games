/**
 * Drizzle table definitions — the durable persistence schema.
 *
 * Four aggregates:
 *   sessions          – lightweight, no-PII identity tokens
 *   game_results      – durable record of every completed/abandoned game
 *   leaderboard_entries – per-game, per-scope standings (score or W/L/D)
 *   share_links       – unguessable tokens resolving to a result, replay, or leaderboard
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
