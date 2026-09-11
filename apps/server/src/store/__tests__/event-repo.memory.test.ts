import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryEventRepo } from "../memory/event-repo.memory.js";
import type { EventRepo } from "../ports.js";

describe("EventRepo — in-memory (MPG-097)", () => {
  let repo: EventRepo;

  const T0 = new Date("2026-09-01T00:00:00.000Z");
  const T1 = new Date("2026-09-02T00:00:00.000Z");
  const T2 = new Date("2026-09-03T00:00:00.000Z");

  beforeEach(() => {
    repo = createMemoryEventRepo();
  });

  it("records a batch and counts by name", async () => {
    await repo.record([
      { name: "result_saved", ownerToken: "a", createdAt: T0 },
      { name: "result_saved", ownerToken: "b", createdAt: T0 },
      { name: "share_minted", ownerToken: "a", createdAt: T0 },
    ]);

    expect(await repo.countByName(T0, T2)).toEqual([
      { name: "result_saved", count: 2 },
      { name: "share_minted", count: 1 },
    ]);
  });

  it("treats the window as half-open so adjacent windows neither overlap nor gap", async () => {
    await repo.record([
      { name: "first_input", ownerToken: "a", createdAt: T0 },
      { name: "first_input", ownerToken: "a", createdAt: T1 },
    ]);

    // T0 is included, T1 is not — the same event must never be counted in two
    // adjacent daily buckets.
    expect(await repo.countByName(T0, T1)).toEqual([{ name: "first_input", count: 1 }]);
    expect(await repo.countByName(T1, T2)).toEqual([{ name: "first_input", count: 1 }]);
  });

  it("counts distinct owners, not occurrences", async () => {
    await repo.record([
      { name: "share_opened", ownerToken: "a", createdAt: T0 },
      { name: "share_opened", ownerToken: "a", createdAt: T0 },
      { name: "share_opened", ownerToken: "b", createdAt: T0 },
    ]);

    expect(await repo.countDistinctOwners("share_opened", T0, T2)).toBe(2);
  });

  it("defaults createdAt to now when the caller does not supply one", async () => {
    const before = Date.now();
    await repo.record([{ name: "share_minted", ownerToken: "a" }]);

    const rows = await repo.countByName(new Date(before - 1), new Date(Date.now() + 1000));
    expect(rows).toEqual([{ name: "share_minted", count: 1 }]);
  });

  it("deletes by owner — the erasure path a session delete cascades into", async () => {
    await repo.record([
      { name: "first_input", ownerToken: "a", createdAt: T0 },
      { name: "first_input", ownerToken: "b", createdAt: T0 },
    ]);

    expect(await repo.deleteByOwner("a")).toBe(1);
    expect(await repo.countByName(T0, T2)).toEqual([{ name: "first_input", count: 1 }]);
  });

  it("deletes older than a cutoff", async () => {
    await repo.record([
      { name: "first_input", ownerToken: "a", createdAt: T0 },
      { name: "first_input", ownerToken: "a", createdAt: T2 },
    ]);

    expect(await repo.deleteOlderThan(T1)).toBe(1);
    expect(await repo.countByName(T0, new Date("2100-01-01"))).toEqual([
      { name: "first_input", count: 1 },
    ]);
  });

  it("accepts an empty batch", async () => {
    await expect(repo.record([])).resolves.toBeUndefined();
  });
});
