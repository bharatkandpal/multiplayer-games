import { describe, expect, it } from "vitest";
import { buildGameItems, indexOfGame, nextGame, prevGame, type GameItem } from "./catalog";

describe("catalog — buildGameItems", () => {
  it("lists turn-based games first, then real-time, each tagged by kind", () => {
    const items = buildGameItems(["connect4", "nim"], ["drunk-walk"]);
    expect(items).toEqual([
      { kind: "turn-based", id: "connect4", title: "Connect Four" },
      { kind: "turn-based", id: "nim", title: "Nim" },
      { kind: "realtime", id: "drunk-walk", title: "Drunk Walk" },
    ]);
  });

  // Gomoku is in the engine's `builtInGames` but has no catalog entry, so it is
  // deliberately unreachable in the UI until MPG-107 adds one. Filtering here
  // (rather than in each consumer) is what keeps Home and the prev/next
  // switcher from disagreeing about which games exist.
  it("drops registered ids that have no catalog entry", () => {
    const items = buildGameItems(["connect4", "gomoku"], []);
    expect(items.map((item) => item.id)).toEqual(["connect4"]);
  });

  it("tolerates an empty real-time registry", () => {
    expect(buildGameItems(["connect4"])).toHaveLength(1);
  });
});

describe("catalog — prev/next navigation", () => {
  const items = buildGameItems(["connect4", "nim"], ["drunk-walk"]);

  it("walks forward through the list", () => {
    expect(nextGame(items, "connect4")?.id).toBe("nim");
    expect(nextGame(items, "nim")?.id).toBe("drunk-walk");
  });

  it("walks backward through the list", () => {
    expect(prevGame(items, "drunk-walk")?.id).toBe("nim");
    expect(prevGame(items, "nim")?.id).toBe("connect4");
  });

  // Wrapping is what makes both arrows always actionable — without it the
  // first and last games would each have a dead control.
  it("wraps forward off the end to the first game", () => {
    expect(nextGame(items, "drunk-walk")?.id).toBe("connect4");
  });

  it("wraps backward off the front to the last game", () => {
    expect(prevGame(items, "connect4")?.id).toBe("drunk-walk");
  });

  it("crosses the turn-based / real-time boundary in both directions", () => {
    expect(nextGame(items, "nim")?.kind).toBe("realtime");
    expect(prevGame(items, "drunk-walk")?.kind).toBe("turn-based");
  });

  it("returns undefined for a game that isn't listed", () => {
    expect(nextGame(items, "gomoku")).toBeUndefined();
    expect(prevGame(items, "gomoku")).toBeUndefined();
    expect(indexOfGame(items, "gomoku")).toBe(-1);
  });

  it("returns undefined when there is nowhere to go (single-game catalog)", () => {
    const solo: GameItem[] = buildGameItems(["connect4"], []);
    expect(nextGame(solo, "connect4")).toBeUndefined();
    expect(prevGame(solo, "connect4")).toBeUndefined();
  });

  it("returns undefined on an empty catalog", () => {
    expect(nextGame([], "connect4")).toBeUndefined();
  });
});
