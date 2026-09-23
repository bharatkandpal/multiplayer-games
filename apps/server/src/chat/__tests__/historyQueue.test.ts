import { describe, expect, it, vi } from "vitest";

import { createChatHistoryQueue } from "../historyQueue.js";
import type { ChatMessageRepo, NewChatMessage } from "../../store/ports.js";

function message(id: string): NewChatMessage {
  return {
    id,
    channel: "chat:room-1",
    roomId: "room-1",
    senderToken: "tok-sender",
    senderName: "Ann",
    text: `text ${id}`,
    ts: 1_700_000_000_000,
  };
}

/** A repo that records what it was asked to write, and can be made to fail. */
function fakeRepo(
  opts: { failTimes?: number; withBatch?: boolean } = {},
): ChatMessageRepo & { written: NewChatMessage[]; calls: number } {
  let remainingFailures = opts.failTimes ?? 0;
  const written: NewChatMessage[] = [];
  const repo = {
    written,
    calls: 0,
    append: vi.fn(async (msg: NewChatMessage) => {
      repo.calls++;
      if (remainingFailures > 0) {
        remainingFailures--;
        throw new Error("store down");
      }
      written.push(msg);
    }),
    page: vi.fn(async () => []),
    deleteByOwner: vi.fn(async () => 0),
    deleteOlderThan: vi.fn(async () => 0),
  } as ChatMessageRepo & { written: NewChatMessage[]; calls: number };

  if (opts.withBatch !== false) {
    repo.appendMany = vi.fn(async (batch: readonly NewChatMessage[]) => {
      repo.calls++;
      if (remainingFailures > 0) {
        remainingFailures--;
        throw new Error("store down");
      }
      written.push(...batch);
    });
  }
  return repo;
}

describe("chat history queue (CHAT-023)", () => {
  it("answers immediately and writes the window afterwards, in one batch", async () => {
    const repo = fakeRepo();
    const queue = createChatHistoryQueue(repo, { flushDelayMs: 0 });

    await queue.enqueue(message("a"));
    await queue.enqueue(message("b"));
    await queue.enqueue(message("c"));

    // Nothing has touched the store yet — that is the whole point: the sender
    // was already answered and the message already delivered over Ably.
    expect(repo.calls).toBe(0);
    expect(queue.size).toBe(3);

    await queue.drain();

    // Three messages, one round trip.
    expect(repo.calls).toBe(1);
    expect(repo.written.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(queue.size).toBe(0);
  });

  it("falls back to one-at-a-time writes for a repo without a batch insert", async () => {
    const repo = fakeRepo({ withBatch: false });
    const queue = createChatHistoryQueue(repo, { flushDelayMs: 0 });

    await queue.enqueue(message("a"));
    await queue.enqueue(message("b"));
    await queue.drain();

    expect(repo.calls).toBe(2);
    expect(repo.written.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("flushes on its own after the window, with no drain", async () => {
    vi.useFakeTimers();
    try {
      const repo = fakeRepo();
      const queue = createChatHistoryQueue(repo, { flushDelayMs: 250 });

      await queue.enqueue(message("a"));
      expect(repo.calls).toBe(0);

      await vi.advanceTimersByTimeAsync(250);
      expect(repo.written.map((m) => m.id)).toEqual(["a"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a failed batch, then gives up without ever throwing", async () => {
    const warn = vi.fn();
    // Fails twice, succeeds on the third attempt.
    const repo = fakeRepo({ failTimes: 2 });
    const queue = createChatHistoryQueue(repo, { flushDelayMs: 0, onWarn: warn });

    await queue.enqueue(message("a"));
    await queue.drain();

    expect(repo.written.map((m) => m.id)).toEqual(["a"]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("drops a batch the store will not take — history degrades, nothing throws", async () => {
    const warn = vi.fn();
    const repo = fakeRepo({ failTimes: Number.MAX_SAFE_INTEGER });
    const queue = createChatHistoryQueue(repo, {
      flushDelayMs: 0,
      maxAttempts: 2,
      onWarn: warn,
    });

    await expect(queue.enqueue(message("a"))).resolves.toBeUndefined();
    await expect(queue.drain()).resolves.toBeUndefined();

    expect(repo.written).toHaveLength(0);
    expect(queue.size).toBe(0);
    expect(warn.mock.calls.some(([m]) => String(m).includes("dropped"))).toBe(true);
  });

  it("drops the oldest under a sustained outage rather than growing without bound", async () => {
    const warn = vi.fn();
    const repo = fakeRepo();
    const queue = createChatHistoryQueue(repo, {
      flushDelayMs: 10_000,
      maxQueued: 3,
      onWarn: warn,
    });

    for (const id of ["a", "b", "c", "d", "e"]) await queue.enqueue(message(id));

    expect(queue.size).toBe(3);
    await queue.drain();
    // The newest survive: they are the ones still on someone's screen.
    expect(repo.written.map((m) => m.id)).toEqual(["c", "d", "e"]);
    expect(warn).toHaveBeenCalled();
  });

  it("writes inside the call in inline mode (the serverless posture)", async () => {
    const repo = fakeRepo();
    const queue = createChatHistoryQueue(repo, { mode: "inline" });

    await queue.enqueue(message("a"));

    // No window, no timer: written by the time enqueue resolves, because a
    // function instance may be frozen the moment the response ends.
    expect(repo.written.map((m) => m.id)).toEqual(["a"]);
    expect(queue.size).toBe(0);
  });

  it("swallows an inline failure too — a downed store never fails a send", async () => {
    const warn = vi.fn();
    const repo = fakeRepo({ failTimes: 1 });
    const queue = createChatHistoryQueue(repo, { mode: "inline", onWarn: warn });

    await expect(queue.enqueue(message("a"))).resolves.toBeUndefined();
    expect(repo.written).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });
});
