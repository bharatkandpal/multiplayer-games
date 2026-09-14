CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"recovery_code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_handle_lower_idx" ON "identities" USING btree (lower("handle"));--> statement-breakpoint
CREATE INDEX "identities_recovery_idx" ON "identities" USING btree ("recovery_code_hash");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_identity_idx" ON "sessions" USING btree ("identity_id");