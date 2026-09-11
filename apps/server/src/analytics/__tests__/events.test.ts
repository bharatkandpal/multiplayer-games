import { describe, expect, it } from "vitest";

import {
  EVENT_NAMES,
  isClientReportable,
  isEventName,
  resolveOccurredAt,
  sanitizeProps,
} from "../events.js";

describe("isEventName", () => {
  it("accepts every name in the taxonomy", () => {
    for (const name of EVENT_NAMES) {
      expect(isEventName(name)).toBe(true);
    }
  });

  it("rejects near-misses rather than storing them", () => {
    // The whole reason the taxonomy is closed: these are the spellings that
    // would otherwise accumulate and silently split a funnel count.
    for (const bad of ["shareOpened", "share-opened", "SHARE_OPENED", "", "nope"]) {
      expect(isEventName(bad)).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    for (const bad of [null, undefined, 42, {}, ["share_opened"]]) {
      expect(isEventName(bad)).toBe(false);
    }
  });
});

describe("isClientReportable", () => {
  it("allows the client to report only what the server cannot see", () => {
    expect(isClientReportable("first_input")).toBe(true);
  });

  it("refuses server-side truth from the client", () => {
    // Accepting these from a browser would let anyone with curl inflate the
    // share rate, and would double-count on any retry.
    expect(isClientReportable("share_minted")).toBe(false);
    expect(isClientReportable("share_opened")).toBe(false);
    expect(isClientReportable("result_saved")).toBe(false);
  });
});

describe("sanitizeProps", () => {
  it("treats absent props as null rather than an error", () => {
    expect(sanitizeProps(undefined)).toEqual({ ok: true, value: null });
    expect(sanitizeProps(null)).toEqual({ ok: true, value: null });
  });

  it("passes through small scalars", () => {
    const out = sanitizeProps({ msSinceArrival: 1200, viaShare: true, kind: "result" });
    expect(out).toEqual({
      ok: true,
      value: { msSinceArrival: 1200, viaShare: true, kind: "result" },
    });
  });

  it("rejects nested objects and arrays", () => {
    expect(sanitizeProps({ nested: { a: 1 } }).ok).toBe(false);
    expect(sanitizeProps({ list: [1, 2] }).ok).toBe(false);
    expect(sanitizeProps([1, 2]).ok).toBe(false);
  });

  it("rejects long strings — the privacy boundary, not a size preference", () => {
    // A URL, a user agent, or a typed message all arrive as an over-long
    // string. Rejecting the shape is what keeps them out of the table.
    expect(sanitizeProps({ url: "x".repeat(65) }).ok).toBe(false);
    expect(sanitizeProps({ ok: "x".repeat(64) }).ok).toBe(true);
  });

  it("rejects non-finite numbers, which would land as null after a JSON round trip", () => {
    expect(sanitizeProps({ n: Number.NaN }).ok).toBe(false);
    expect(sanitizeProps({ n: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it("rejects oversized bags", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 9; i++) big[`k${i}`] = i;
    expect(sanitizeProps(big).ok).toBe(false);
  });
});

describe("resolveOccurredAt", () => {
  const now = new Date("2026-09-11T12:00:00.000Z");

  it("keeps a plausible client timestamp", () => {
    const t = now.getTime() - 30_000;
    expect(resolveOccurredAt(t, now).getTime()).toBe(t);
  });

  it("falls back to server-now for a wildly stale clock rather than dropping the event", () => {
    // Losing the event entirely would defeat the point of the task; a slightly
    // mis-timed event is the smaller lie.
    expect(resolveOccurredAt(0, now).getTime()).toBe(now.getTime());
  });

  it("falls back to server-now for a future clock", () => {
    expect(resolveOccurredAt(now.getTime() + 60 * 60 * 1000, now).getTime()).toBe(now.getTime());
  });

  it("tolerates small forward skew", () => {
    const t = now.getTime() + 60_000;
    expect(resolveOccurredAt(t, now).getTime()).toBe(t);
  });

  it("falls back for non-numeric input", () => {
    expect(resolveOccurredAt("nope", now).getTime()).toBe(now.getTime());
    expect(resolveOccurredAt(undefined, now).getTime()).toBe(now.getTime());
  });
});
