import { describe, expect, it } from "vitest";
import type { GameId } from "@mpg/engine";
import {
  buildGameItems,
  gameTags,
  hasTag,
  indexOfGame,
  nextGame,
  prevGame,
  GAME_CATALOG,
  REALTIME_CATALOG,
  type GameCatalogEntry,
  type GameItem,
} from "./catalog";

describe("catalog — buildGameItems", () => {
  it("lists turn-based games first, then real-time, each tagged by kind", () => {
    const items = buildGameItems(["connect4", "nim"], ["drunk-walk"]);
    expect(items).toEqual([
      { kind: "turn-based", id: "connect4", title: "Connect Four" },
      { kind: "turn-based", id: "nim", title: "Nim" },
      { kind: "realtime", id: "drunk-walk", title: "Drunk Walk" },
    ]);
  });

  // Filtering here (rather than in each consumer) is what keeps Home and the
  // prev/next switcher from disagreeing about which games exist. This used to be
  // demonstrated with Gomoku, which sat in the engine's `builtInGames` with no
  // catalog entry and was therefore silently unreachable; MPG-107 gave it one, so
  // every real GameId is now catalogued and the case needs a synthetic id. The
  // invariant still matters: the next engine-first game must stay hidden, not
  // half-appear.
  it("drops registered ids that have no catalog entry", () => {
    const uncatalogued = "not-in-catalog" as GameId;
    const items = buildGameItems(["connect4", uncatalogued], []);
    expect(items.map((item) => item.id)).toEqual(["connect4"]);
  });

  it("tolerates an empty real-time registry", () => {
    expect(buildGameItems(["connect4"])).toHaveLength(1);
  });
});

describe("catalog — tags (UI-3)", () => {
  const connect4 = GAME_CATALOG.connect4!;
  const floppy = REALTIME_CATALOG["floppy-birds"]!;

  it("puts the derived seat tag first, then the authored tags in order", () => {
    expect(gameTags(connect4)).toEqual(["2-player", "vs-bot", "online", "watch"]);
  });

  it("treats every real-time game as solo — they have no seats at all", () => {
    expect(gameTags(floppy)).toEqual(["solo", "endless"]);
  });

  // The whole reason the seat tag is derived rather than authored: it cannot
  // drift away from what the engine actually reports.
  it("derives the seat tag from playerCount, not from the authored list", () => {
    const base = { ...connect4 };
    expect(gameTags({ ...base, playerCount: 1 })[0]).toBe("solo");
    expect(gameTags({ ...base, playerCount: 2 })[0]).toBe("2-player");
  });

  // Per the seat model, 1v1 is only the current shape — nothing may hardcode 2.
  it("classifies a three-or-more-seat game as multiplayer", () => {
    const threeSeat: GameCatalogEntry = { ...connect4, playerCount: 3 };
    expect(gameTags(threeSeat)[0]).toBe("multiplayer");
    expect(hasTag(threeSeat, "2-player")).toBe(false);
  });

  it("never lets an entry author a seat tag by hand", () => {
    // `AuthoredGameTag` excludes them at the type level; assert the data too,
    // so a future entry can't sneak one in via a cast.
    const authored = [...Object.values(GAME_CATALOG), ...Object.values(REALTIME_CATALOG)].flatMap(
      (entry) => [...entry.tags],
    );
    expect(authored).not.toContain("solo");
    expect(authored).not.toContain("2-player");
    expect(authored).not.toContain("multiplayer");
  });

  it("matches tags through hasTag, including the derived one", () => {
    expect(hasTag(connect4, "online")).toBe(true);
    expect(hasTag(connect4, "2-player")).toBe(true);
    expect(hasTag(connect4, "endless")).toBe(false);
    expect(hasTag(floppy, "solo")).toBe(true);
  });

  it("gives every catalogued game at least one tag beyond the seat tag", () => {
    for (const entry of [...Object.values(GAME_CATALOG), ...Object.values(REALTIME_CATALOG)]) {
      expect(gameTags(entry).length).toBeGreaterThan(1);
    }
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
