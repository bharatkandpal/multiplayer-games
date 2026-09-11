import { afterEach, describe, expect, it } from "vitest";
import { loadStored2048Size, store2048Size } from "./game2048Size";

describe("game2048Size storage", () => {
  afterEach(() => window.localStorage.clear());

  it("defaults to 4 when nothing is stored", () => {
    expect(loadStored2048Size()).toBe(4);
  });

  it("round-trips a valid size", () => {
    store2048Size(3);
    expect(loadStored2048Size()).toBe(3);
    store2048Size(5);
    expect(loadStored2048Size()).toBe(5);
  });

  it("falls back to the default for an invalid stored value", () => {
    window.localStorage.setItem("mpg:2048:size", "7");
    expect(loadStored2048Size()).toBe(4);
  });
});
