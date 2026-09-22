import type { ChatMessageRepo, ChatStoredMessage } from "../ports.js";

/**
 * In-memory chat history (dev + Vitest).
 *
 * Unbounded by design, matching the other memory repos: this backs a
 * short-lived dev process or a test run. Anything durable runs Postgres.
 *
 * `(ts, id)` is the total order — the same one the PG adapter's compound index
 * enforces — so paging behaves identically across adapters, ties and all.
 */
export function createMemoryChatMessageRepo(): ChatMessageRepo {
  const messages: ChatStoredMessage[] = [];

  // Newest first: higher ts wins; ties break by id (descending) so the order is
  // total and a same-millisecond cursor pages cleanly.
  const newestFirst = (a: ChatStoredMessage, b: ChatStoredMessage): number =>
    b.ts - a.ts || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  return {
    async append(message) {
      // Idempotent on id — a retried write is a no-op, never a duplicate.
      if (messages.some((m) => m.id === message.id)) return;
      messages.push({
        id: message.id,
        channel: message.channel,
        roomId: message.roomId,
        senderToken: message.senderToken,
        senderName: message.senderName,
        text: message.text,
        ts: message.ts,
      });
    },

    async page(channel, opts) {
      const before = opts.before;
      const page = messages
        .filter((m) => m.channel === channel)
        .filter((m) => {
          if (!before) return true;
          // Strictly older than the cursor in the (ts, id) total order.
          return m.ts < before.ts || (m.ts === before.ts && m.id < before.id);
        })
        .sort(newestFirst);
      return page.slice(0, Math.max(0, opts.limit));
    },

    async deleteByOwner(senderToken) {
      let count = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]!.senderToken === senderToken) {
          messages.splice(i, 1);
          count++;
        }
      }
      return count;
    },

    async deleteOlderThan(cutoff) {
      let count = 0;
      const cutoffMs = cutoff.getTime();
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]!.ts < cutoffMs) {
          messages.splice(i, 1);
          count++;
        }
      }
      return count;
    },
  };
}
