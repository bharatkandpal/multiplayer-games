CREATE TABLE "game_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"game_id" text NOT NULL,
	"game_family" text DEFAULT 'turn-based' NOT NULL,
	"event_id" text,
	"owner_token" text NOT NULL,
	"status" text NOT NULL,
	"winner_slot" integer,
	"score" integer,
	"seats_snapshot" jsonb NOT NULL,
	"duration_ms" integer,
	"move_log" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_results_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" text NOT NULL,
	"metric" text NOT NULL,
	"event_id" text,
	"time_bucket" text,
	"owner_token" text NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"best_score" integer,
	"total_games" integer DEFAULT 0 NOT NULL,
	"run_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_upsert_key" UNIQUE("game_id","event_id","time_bucket","owner_token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"owner_token" text NOT NULL,
	"event_id" text,
	"expires_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_owner_token_sessions_token_fk" FOREIGN KEY ("owner_token") REFERENCES "public"."sessions"("token") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_owner_token_sessions_token_fk" FOREIGN KEY ("owner_token") REFERENCES "public"."sessions"("token") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_owner_token_sessions_token_fk" FOREIGN KEY ("owner_token") REFERENCES "public"."sessions"("token") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_results_owner_idx" ON "game_results" USING btree ("owner_token");--> statement-breakpoint
CREATE INDEX "game_results_game_event_idx" ON "game_results" USING btree ("game_id","event_id");--> statement-breakpoint
CREATE INDEX "game_results_created_idx" ON "game_results" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leaderboard_rank_idx" ON "leaderboard_entries" USING btree ("game_id","metric","best_score");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_username_lower_idx" ON "sessions" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "share_links_owner_idx" ON "share_links" USING btree ("owner_token");