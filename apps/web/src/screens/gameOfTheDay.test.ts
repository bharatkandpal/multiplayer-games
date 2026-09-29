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

  // Regression for MPG-149: a fixed stride of 7 only cycles through the full
  // catalog when 7 and the catalog length are coprime. At 14 games
  // gcd(7, 14) = 7, so the old code could only ever land on two indices and
  // the spotlight never reached most of the catalog. Assert full coverage
  // over a year for a couple of sizes, including one (14) that collides with
  // the old hardcoded stride.
  describe("covers the whole catalog over a year", () => {
    it.each([3, 7, 14, 20])("catalog of size %i", (size) => {
      const catalog: { id: string }[] = Array.from({ length: size }, (_, i) => ({
        id: `game-${i}`,
      }));

      const seen = new Set<string>();
      const start = new Date("2026-01-01T12:00:00");
      for (let d = 0; d < 365; d += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + d);
        const pick = pickGameOfTheDay(catalog, date);
        if (pick) seen.add(pick.id);
      }

      expect(seen.size).toBe(size);
    });
  });
});
