import { describe, expect, it } from "vitest";
import { pickGameOfTheDay } from "./gameOfTheDay";
import type { GameItem } from "./catalog";

const items: GameItem[] = [
  { kind: "turn-based", id: "tictactoe", title: "Tic-Tac-Toe" },
  { kind: "turn-based", id: "connect4", title: "Connect Four" },
  { kind: "realtime", id: "2048", title: "2048" },
];

describe("pickGameOfTheDay", () => {
  it("returns undefined for an empty catalog", () => {
    expect(pickGameOfTheDay([], new Date("2026-09-11T10:00:00"))).toBeUndefined();
  });

  it("is stable across the same calendar day", () => {
    const morning = pickGameOfTheDay(items, new Date("2026-09-11T08:00:00"));
    const night = pickGameOfTheDay(items, new Date("2026-09-11T23:59:00"));
    expect(morning).toEqual(night);
  });

  it("changes across days as it walks the catalog", () => {
    const picks = new Set<string>();
    for (let d = 11; d <= 17; d += 1) {
      const pick = pickGameOfTheDay(items, new Date(`2026-09-${d}T12:00:00`));
      if (pick) picks.add(pick.id);
    }
    // Over a week the spotlight visits more than one game.
    expect(picks.size).toBeGreaterThan(1);
  });

  it("always returns a member of the catalog", () => {
    for (let d = 1; d <= 28; d += 1) {
      const pick = pickGameOfTheDay(
        items,
        new Date(`2026-09-${String(d).padStart(2, "0")}T12:00:00`),
      );
      expect(items).toContainEqual(pick);
    }
  });
});
