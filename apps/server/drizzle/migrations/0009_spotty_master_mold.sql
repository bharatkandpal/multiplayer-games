--
-- CRTR-001b — accounts schema (ADR 0012). Additive only: new tables plus one
-- nullable column on "sessions"; no existing row is touched.
--
-- PROD MIGRATIONS ARE MANUAL: deploy.yml does not run db:migrate. Apply this by
-- hand with a valid prod DATABASE_URL BEFORE deploying code that reads these
-- tables. Rollback: drizzle/rollbacks/0009_spotty_master_mold.down.sql.
--
-- "account"."email" is citext so its UNIQUE constraint is case-insensitive. The
-- role running migrations needs CREATE on the database (Neon and the local
-- docker postgres both allow citext); the statement is a no-op if present.
--
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_request" ADD CONSTRAINT "creator_request_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_request" ADD CONSTRAINT "creator_request_decided_by_account_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_session_secret_idx" ON "auth_session" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "auth_session_account_idx" ON "auth_session" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "auth_session_expires_idx" ON "auth_session" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_request_one_pending_idx" ON "creator_request" USING btree ("account_id") WHERE "creator_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "creator_request_status_idx" ON "creator_request" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");