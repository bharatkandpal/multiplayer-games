import { and, desc, eq, lt, or } from "drizzle-orm";

import type { Database } from "../../db/drizzle.js";
import { chatMessages } from "../../db/schema.js";
import type { ChatMessageRepo, ChatStoredMessage } from "../ports.js";

function toMessage(row: typeof chatMessages.$inferSelect): ChatStoredMessage {
  return {
    id: row.id,
    channel: row.channel,
    roomId: row.roomId,
    senderToken: row.senderToken,
    senderName: row.senderName,
    text: row.text,
    // Stored as the message's authoritative broadcast time; hand it back as
    // epoch ms so it matches the live wire shape (`ChatMessage.ts`).
    ts: row.createdAt.getTime(),
  };
}

export function createPgChatMessageRepo(db: Database): ChatMessageRepo {
  return {
    async append(message) {
      await db
        .insert(chatMessages)
        .values({
          id: message.id,
          channel: message.channel,
          roomId: message.roomId,
          senderToken: message.senderToken,
          senderName: message.senderName,
          text: message.text,
          createdAt: new Date(message.ts),
        })
        // Idempotent on id — a retried persist (or a re-delivered id) is a no-op.
        .onConflictDoNothing({ target: chatMessages.id });
    },

    async page(channel, opts) {
      const before = opts.before;
      // Strictly older than the cursor in the (created_at, id) total order:
      // created_at < ts OR (created_at == ts AND id < id).
      const olderThanCursor = before
        ? or(
            lt(chatMessages.createdAt, new Date(before.ts)),
            and(eq(chatMessages.createdAt, new Date(before.ts)), lt(chatMessages.id, before.id)),
          )
        : undefined;

      const rows = await db
        .select()
        .from(chatMessages)
        .where(
          olderThanCursor
            ? and(eq(chatMessages.channel, channel), olderThanCursor)
            : eq(chatMessages.channel, channel),
        )
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(Math.max(0, opts.limit));
      return rows.map(toMessage);
    },

    async deleteByOwner(senderToken) {
      const rows = await db
        .delete(chatMessages)
        .where(eq(chatMessages.senderToken, senderToken))
        .returning({ id: chatMessages.id });
      return rows.length;
    },

    async deleteOlderThan(cutoff) {
      const rows = await db
        .delete(chatMessages)
        .where(lt(chatMessages.createdAt, cutoff))
        .returning({ id: chatMessages.id });
      return rows.length;
    },
  };
}
