/**
 * Write-behind queue for durable chat history (CHAT-023).
 *
 * Delivery and persistence are two different jobs with two different
 * deadlines. A message is *delivered* the moment the server publishes it to
 * Ably — that is the realtime path, and the sender's optimistic bubble
 * (CHAT-018) reconciles against that broadcast, not against our database.
 * Persistence (CHAT-021) exists so someone who scrolls up tomorrow can read it,
 * which is a job that can happen a quarter of a second later without anyone
 * noticing.
 *
 * So: the route hands each message to this queue and answers the sender
 * immediately; the queue batches a window of messages into one insert and
 * writes them behind the request. The database is off the send path entirely —
 * a slow store can no longer slow down sending, and an outage degrades history
 * to absence exactly as CLAUDE.md's offline pillar requires.
 *
 * What this deliberately is *not*: a durable job queue. Everything here lives
 * in one process's memory. A crash loses at most one unflushed window, and
 * history is best-effort by design (ADR 0005 started ephemeral; CHAT-021 made
 * it a convenience, never a source of truth). If history ever becomes something
 * we promise, this needs to become a real queue with an external broker — not a
 * bigger buffer.
 */

import type { ChatMessageRepo, NewChatMessage } from "../store/ports.js";

/**
 * When the database write happens relative to the HTTP response.
 *
 * - `write-behind` — batched, after the response. The long-running container,
 *   where the process outlives the request and a timer is guaranteed to fire.
 * - `inline` — awaited inside the request, i.e. no queue at all. Required on
 *   serverless: a Vercel instance may be frozen the instant the response ends,
 *   so work scheduled past it is silently dropped. Losing history quietly is
 *   worse than spending the latency (same reasoning as `apiApp.ts`'s refusal
 *   to boot the serverless API on the in-memory store).
 */
export type ChatHistoryWriteMode = "write-behind" | "inline";

export interface ChatHistoryQueueOptions {
  readonly mode?: ChatHistoryWriteMode;
  /** How long a window stays open collecting messages before it is written. */
  readonly flushDelayMs?: number;
  /** Most messages written in a single batch. */
  readonly batchSize?: number;
  /**
   * Most messages held at once. Past this the **oldest** are dropped: under a
   * sustained store outage the queue must not grow without bound, and the
   * newest messages are the ones most likely to still be on someone's screen.
   */
  readonly maxQueued?: number;
  /** Attempts per batch before it is dropped. */
  readonly maxAttempts?: number;
  /** Reporting seam — defaults to `console.warn`/`console.error`. */
  readonly onWarn?: (message: string, err?: unknown) => void;
}

export interface ChatHistoryQueue {
  /**
   * Hand a message to history.
   *
   * In `write-behind` mode this resolves immediately — the message is queued,
   * not written, and a failure past this point is logged, never surfaced. In
   * `inline` mode it resolves once the write has been attempted. It never
   * rejects in either mode: the message is already delivered, and a history
   * failure must not turn into a failed send.
   */
  enqueue(message: NewChatMessage): Promise<void>;
  /** Resolves once everything queued at call time has been written or dropped. */
  drain(): Promise<void>;
  /** Messages waiting to be written. Diagnostics and tests. */
  readonly size: number;
}

const DEFAULT_FLUSH_DELAY_MS = 250;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_QUEUED = 1_000;
const DEFAULT_MAX_ATTEMPTS = 3;

/** Write one batch, preferring the repo's batch insert when it has one. */
async function writeBatch(repo: ChatMessageRepo, batch: readonly NewChatMessage[]): Promise<void> {
  if (repo.appendMany) {
    await repo.appendMany(batch);
    return;
  }
  for (const message of batch) await repo.append(message);
}

export function createChatHistoryQueue(
  repo: ChatMessageRepo,
  options: ChatHistoryQueueOptions = {},
): ChatHistoryQueue {
  const mode = options.mode ?? "write-behind";
  const flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const warn =
    options.onWarn ??
    ((message: string, err?: unknown) => {
      if (err === undefined) console.warn(message);
      else console.error(message, err);
    });

  const pending: NewChatMessage[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let dropped = 0;

  function schedule(): void {
    if (timer !== null || pending.length === 0) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, flushDelayMs);
    // Never hold the process open for a window of chat history.
    timer.unref?.();
  }

  /** Drain the buffer, one batch at a time, retrying a failed batch in place. */
  async function run(): Promise<void> {
    if (running) return running;
    running = (async () => {
      while (pending.length > 0) {
        const batch = pending.splice(0, batchSize);
        let attempt = 0;
        for (;;) {
          attempt++;
          try {
            await writeBatch(repo, batch);
            break;
          } catch (err) {
            if (attempt >= maxAttempts) {
              // History is best-effort: the messages were delivered live, so a
              // store that will not take them costs us the transcript, nothing
              // more. Loudly, but never to the sender.
              warn(
                `[chat] history batch dropped after ${String(attempt)} attempts ` +
                  `(${String(batch.length)} messages, still delivered)`,
                err,
              );
              break;
            }
            warn(`[chat] history batch write failed (attempt ${String(attempt)}), retrying`, err);
          }
        }
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    async enqueue(message) {
      if (mode === "inline") {
        try {
          await repo.append(message);
        } catch (err) {
          warn("[chat] history persist failed (message still delivered)", err);
        }
        return;
      }

      pending.push(message);
      if (pending.length > maxQueued) {
        pending.splice(0, pending.length - maxQueued);
        dropped++;
        // One line per overflow event, not per message: a store outage under
        // load would otherwise turn the log into the problem.
        if (dropped === 1 || dropped % 100 === 0) {
          warn(
            `[chat] history queue full (${String(maxQueued)}), dropping oldest ` +
              `— ${String(dropped)} overflow events so far`,
          );
        }
      }
      schedule();
    },

    async drain() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await run();
    },

    get size() {
      return pending.length;
    },
  };
}
