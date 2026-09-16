--> MPG-133: make the leaderboard upsert key actually unique.
--
-- `event_id` and `time_bucket` are nullable, and a plain UNIQUE treats NULL as
-- distinct from NULL. So for the default leaderboard (no event, no time bucket)
-- the constraint matched nothing, `ON CONFLICT` never fired, and every score
-- submission inserted a fresh row instead of accumulating into the player's.
--
-- Adding the corrected constraint would fail on any database that already ran
-- the broken one, so the duplicates it permitted are collapsed first: the
-- surviving row carries the summed counters and the best score, matching what
-- the accumulating upsert would have produced all along.

UPDATE "leaderboard_entries" AS e SET
  "wins" = agg.wins,
  "losses" = agg.losses,
  "draws" = agg.draws,
  "total_games" = agg.total_games,
  "best_score" = agg.best_score
FROM (
  SELECT
    (array_agg("id" ORDER BY "updated_at" DESC, "id"))[1] AS keep_id,
    sum("wins")::int AS wins,
    sum("losses")::int AS losses,
    sum("draws")::int AS draws,
    sum("total_games")::int AS total_games,
    max("best_score") AS best_score
  FROM "leaderboard_entries"
  GROUP BY "game_id", "event_id", "time_bucket", "owner_token"
) AS agg
WHERE e."id" = agg.keep_id;--> statement-breakpoint

DELETE FROM "leaderboard_entries" WHERE "id" NOT IN (
  SELECT (array_agg("id" ORDER BY "updated_at" DESC, "id"))[1]
  FROM "leaderboard_entries"
  GROUP BY "game_id", "event_id", "time_bucket", "owner_token"
);--> statement-breakpoint

ALTER TABLE "leaderboard_entries" DROP CONSTRAINT "leaderboard_upsert_key";--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_upsert_key" UNIQUE NULLS NOT DISTINCT("game_id","event_id","time_bucket","owner_token");
