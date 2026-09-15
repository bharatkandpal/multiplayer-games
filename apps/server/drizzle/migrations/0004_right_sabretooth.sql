CREATE TABLE "variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_token" text NOT NULL,
	"base_game_id" text NOT NULL,
	"cosmetics" jsonb NOT NULL,
	"forked_from" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_owner_token_sessions_token_fk" FOREIGN KEY ("owner_token") REFERENCES "public"."sessions"("token") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_forked_from_variants_id_fk" FOREIGN KEY ("forked_from") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "variants_owner_idx" ON "variants" USING btree ("owner_token","created_at");--> statement-breakpoint
CREATE INDEX "variants_forked_from_idx" ON "variants" USING btree ("forked_from");