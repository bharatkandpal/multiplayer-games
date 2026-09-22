CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"room_id" text NOT NULL,
	"sender_token" text NOT NULL,
	"sender_name" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_token_sessions_token_fk" FOREIGN KEY ("sender_token") REFERENCES "public"."sessions"("token") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_channel_idx" ON "chat_messages" USING btree ("channel","created_at","id");--> statement-breakpoint
CREATE INDEX "chat_messages_sender_idx" ON "chat_messages" USING btree ("sender_token");