import { describe, expect, it } from "vitest";
import { GAME_CATALOG, REALTIME_CATALOG } from "./catalog";
import { GAME_RULES, REALTIME_RULES, rulesFor } from "./rules";

describe("rulesFor (MPG-138)", () => {
  it("finds rules for a turn-based game", () => {
    expect(rulesFor("connect4")?.goal).toContain("four");
  });

  it("finds rules for a real-time game", () => {
    expect(rulesFor("breakout")?.goal).toContain("bricks");
  });

  it("shares one set of rules across a game's board-size variants", () => {
    // `2048@3` / `2048@5` register as their own modules but are the same game.
    expect(rulesFor("2048@3")).toBe(rulesFor("2048"));
    expect(rulesFor("2048@5")).toBe(rulesFor("2048"));
  });

  it("returns undefined for a game with no rules written, rather than throwing", () => {
    // The play screen reads this as "offer no Rules control at all" — an
    // unwritten game degrades to absence, not to an empty sheet.
    expect(rulesFor("not-a-game")).toBeUndefined();
  });
});

describe("rules content", () => {
  // Every game a player can reach from Home must be explainable there. A new
  // catalogue entry without rules would ship a play screen whose help button
  // simply isn't there — which is graceful, but not what we meant.
  it("covers every listed game", () => {
    const missing = [
      ...Object.keys(GAME_CATALOG).filter((id) => !(id in GAME_RULES)),
      ...Object.keys(REALTIME_CATALOG).filter((id) => !(id in REALTIME_RULES)),
    ];
    expect(missing).toEqual([]);
  });

  it("gives every game a goal and at least two steps", () => {
    for (const [id, rules] of Object.entries({ ...GAME_RULES, ...REALTIME_RULES })) {
      expect(rules.goal.length, `${id} goal`).toBeGreaterThan(0);
      expect(rules.steps.length, `${id} steps`).toBeGreaterThanOrEqual(2);
    }
  });
});
