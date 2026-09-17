import { describe, expect, it } from "vitest";
import { pickRandomGame } from "./randomGame";

const ITEMS = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

/** An RNG that returns the given values in order, then repeats the last one. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe("pickRandomGame", () => {
  it("returns undefined for an empty list", () => {
    expect(pickRandomGame([])).toBeUndefined();
  });

  it("indexes uniformly across the list", () => {
    expect(pickRandomGame(ITEMS, { random: sequence(0) })).toEqual({ id: "a" });
    expect(pickRandomGame(ITEMS, { random: sequence(0.26) })).toEqual({ id: "b" });
    expect(pickRandomGame(ITEMS, { random: sequence(0.99) })).toEqual({ id: "d" });
  });

  it("stays in range for an RNG that can return exactly 1", () => {
    // `Math.random()` never returns 1, but an injected RNG might — and indexing
    // one past the end would return undefined from a list that isn't empty.
    expect(pickRandomGame(ITEMS, { random: sequence(1) })).toEqual({ id: "d" });
  });

  it("never returns the excluded id", () => {
    // With "a" excluded the pool is [b, c, d]; index 0 must be "b", not "a".
    expect(pickRandomGame(ITEMS, { exclude: "a", random: sequence(0) })).toEqual({ id: "b" });
    for (let i = 0; i <= 20; i += 1) {
      const pick = pickRandomGame(ITEMS, { exclude: "c", random: sequence(i / 20) });
      expect(pick?.id).not.toBe("c");
    }
  });

  it("falls back to a repeat rather than nothing when it's the only option", () => {
    // A one-game catalogue (or a filter matching one game): a dead button would
    // be worse than handing back the same game again.
    expect(pickRandomGame([{ id: "solo" }], { exclude: "solo" })).toEqual({ id: "solo" });
  });

  it("ignores an exclusion that isn't in the list", () => {
    expect(pickRandomGame(ITEMS, { exclude: "not-here", random: sequence(0) })).toEqual({
      id: "a",
    });
  });

  it("reaches every item over many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      const pick = pickRandomGame(ITEMS);
      if (pick) seen.add(pick.id);
    }
    expect(seen.size).toBe(ITEMS.length);
  });

  it("does not repeat back-to-back when told the last pick", () => {
    let last: string | undefined;
    for (let i = 0; i < 200; i += 1) {
      const pick = pickRandomGame(ITEMS, { exclude: last });
      expect(pick?.id).not.toBe(last);
      last = pick?.id;
    }
  });
});
