import { describe, expect, it } from "vitest";

import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import { writeGameResult } from "../resultWriter.js";

describe("writeGameResult", () => {
  let store: Store;

  it("persists a game-over result with mapped fields", async () => {
    store = createMemoryStore();
    await store.sessions.upsert("tok-1");

    const result = await writeGameResult(store, {
      runId: "run-1",
      gameId: "tictactoe",
      gameFamily: "turn-based",
      ownerToken: "tok-1",
      status: "win",
      winnerSlot: 0,
      seatsSnapshot: [{ kind: "human" }, { kind: "bot", difficulty: "hard" }],
      durationMs: 1234,
      moveLog: [{ move: 4 }],
    });

    expect(result.runId).toBe("run-1");
    expect(result.gameId).toBe("tictactoe");
    expect(result.gameFamily).toBe("turn-based");
    expect(result.ownerToken).toBe("tok-1");
    expect(result.status).toBe("win");
    expect(result.winnerSlot).toBe(0);
    expect(result.durationMs).toBe(1234);
    expect(result.moveLog).toEqual([{ move: 4 }]);
  });

  it("is idempotent on runId", async () => {
    store = createMemoryStore();
    await store.sessions.upsert("tok-1");

    const first = await writeGameResult(store, {
      runId: "run-dup",
      gameId: "connect4",
      ownerToken: "tok-1",
      status: "win",
      seatsSnapshot: [],
    });

    const second = await writeGameResult(store, {
      runId: "run-dup",
      gameId: "connect4",
      ownerToken: "tok-1",
      status: "draw", // different payload — should be ignored
      seatsSnapshot: [],
    });

    expect(second.id).toBe(first.id);
    expect(second.status).toBe("win");
  });

  it("supports the realtime family with a score instead of a winner slot", async () => {
    store = createMemoryStore();
    await store.sessions.upsert("tok-2");

    const result = await writeGameResult(store, {
      runId: "run-realtime-1",
      gameId: "floppy-birds",
      gameFamily: "realtime",
      ownerToken: "tok-2",
      status: "completed",
      score: 42,
      seatsSnapshot: [{ kind: "human" }],
      moveLog: { seed: "abc", inputs: [1, 0, 1] },
    });

    expect(result.gameFamily).toBe("realtime");
    expect(result.score).toBe(42);
    expect(result.winnerSlot).toBeNull();
    expect(result.moveLog).toEqual({ seed: "abc", inputs: [1, 0, 1] });
  });

  it("defaults optional fields to null and gameFamily to turn-based", async () => {
    store = createMemoryStore();
    await store.sessions.upsert("tok-3");

    const result = await writeGameResult(store, {
      runId: "run-min",
      gameId: "tictactoe",
      ownerToken: "tok-3",
      status: "draw",
      seatsSnapshot: [],
    });

    expect(result.gameFamily).toBe("turn-based");
    expect(result.winnerSlot).toBeNull();
    expect(result.score).toBeNull();
    expect(result.durationMs).toBeNull();
    expect(result.moveLog).toBeNull();
    expect(result.eventId).toBeNull();
  });
});
