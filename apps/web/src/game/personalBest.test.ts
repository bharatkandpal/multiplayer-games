import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPersonalBest, loadPersonalBest, recordPersonalBest } from "./personalBest";

describe("personalBest", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("reads nothing back before any run is recorded", () => {
    expect(loadPersonalBest("floppy-birds")).toBeUndefined();
  });

  it("records a first run, then keeps only the better score", () => {
    expect(recordPersonalBest("floppy-birds", 12)).toBe(12);
    expect(recordPersonalBest("floppy-birds", 5)).toBe(12);
    expect(recordPersonalBest("floppy-birds", 30)).toBe(30);
    expect(loadPersonalBest("floppy-birds")).toBe(30);
  });

  it("records a zero score, which is a real result and not an absent one", () => {
    // Reflex Test scores 0 for a false start — distinct from "never played".
    recordPersonalBest("reflex-test", 0);
    expect(loadPersonalBest("reflex-test")).toBe(0);
  });

  it("keeps each game's best separate", () => {
    recordPersonalBest("floppy-birds", 12);
    recordPersonalBest("drunk-walk", 400);
    expect(loadPersonalBest("floppy-birds")).toBe(12);
    expect(loadPersonalBest("drunk-walk")).toBe(400);
  });

  it("forgets a game's best on request", () => {
    recordPersonalBest("floppy-birds", 12);
    clearPersonalBest("floppy-birds");
    expect(loadPersonalBest("floppy-birds")).toBeUndefined();
  });

  // A best score is an ornament: every failure path degrades to "no best", so
  // it can never take a game down with it.
  it("reads a corrupt entry as no best rather than rendering NaN", () => {
    window.localStorage.setItem("mpg:best:floppy-birds", "not a number");
    expect(loadPersonalBest("floppy-birds")).toBeUndefined();
  });

  it("survives storage being unavailable entirely", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(loadPersonalBest("floppy-birds")).toBeUndefined();
    expect(() => recordPersonalBest("floppy-birds", 12)).not.toThrow();
  });
});
