-- Manual rollback for 0009_spotty_master_mold (CRTR-001b). drizzle-kit has no
-- down migrations, so this lives OUTSIDE drizzle/migrations (the journal never
-- reads it). Run by hand: psql "$DATABASE_URL" -f <this file>
-- Also delete the 0009 row from drizzle."__drizzle_migrations" if you intend to
-- re-apply the migration afterwards.
--
-- DESTRUCTIVE: drops every account, creator request and login session.
-- The citext extension is intentionally left installed (harmless, may be shared).
BEGIN;
DROP INDEX IF EXISTS "sessions_account_idx";
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_account_id_account_id_fk";
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "account_id";
DROP TABLE IF EXISTS "auth_session";
DROP TABLE IF EXISTS "creator_request";
DROP TABLE IF EXISTS "account";
COMMIT;
