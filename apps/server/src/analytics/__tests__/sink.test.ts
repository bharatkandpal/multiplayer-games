import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventRepo } from "../../store/ports.js";
import { createNullSink, createStoreSink, emit } from "../sink.js";

describe("EventSink (MPG-097)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A repo whose every write fails — i.e. the database is down. */
  function brokenRepo(): EventRepo {
    return {
      record: () => Promise.reject(new Error("db is down")),
      countByName: () => Promise.resolve([]),
      countDistinctOwners: () => Promise.resolve(0),
      deleteByOwner: () => Promise.resolve(0),
      deleteOlderThan: () => Promise.resolve(0),
    };
  }

  it("swallows a failing write — instrumentation may never break what it measures", async () => {
    const sink = createStoreSink(brokenRepo());

    // The contract the call sites depend on. If this ever rejects, a share mint
    // 500s because the analytics table was unavailable.
    await expect(
      sink.record([{ name: "share_minted", ownerToken: "tok" }]),
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("does not call the repo for an empty batch", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const sink = createStoreSink({ ...brokenRepo(), record });

    await sink.record([]);

    expect(record).not.toHaveBeenCalled();
  });

  it("emit() never produces an unhandled rejection", async () => {
    const sink = createStoreSink(brokenRepo());

    // `emit` is deliberately fire-and-forget, so a rejecting sink would surface
    // as an unhandled rejection that takes the process down under Node's
    // default. The swallow above is what prevents it.
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    emit(sink, { name: "result_saved", ownerToken: "tok" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("the null sink accepts everything and stores nothing", async () => {
    await expect(
      createNullSink().record([{ name: "first_input", ownerToken: "tok" }]),
    ).resolves.toBeUndefined();
  });
});
