CREATE TABLE "chat_rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"visibility" text NOT NULL,
	"secret" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_rooms_sort_idx" ON "chat_rooms" USING btree ("sort_order","id");--> statement-breakpoint
--
-- Seed the room set. Rooms are administrator-owned (no create endpoint), so
-- these two are the entire set until someone edits this table. Keep in sync
-- with src/chat/defaultRooms.ts, which seeds the in-memory store identically.
--
-- The private room's secret is a placeholder, meant to be rotated here:
--   UPDATE "chat_rooms" SET "secret" = '<new code>' WHERE "id" = 'pvt';
--
-- ON CONFLICT DO NOTHING so re-running against a database that already has
-- these rows (or admin-renamed ones) is a no-op rather than a failure.
INSERT INTO "chat_rooms" ("id", "label", "visibility", "secret", "sort_order") VALUES
	('global', 'Global', 'public', NULL, 0),
	('pvt', 'Private', 'private', '1234', 1)
ON CONFLICT ("id") DO NOTHING;