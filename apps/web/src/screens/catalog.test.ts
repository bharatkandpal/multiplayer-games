import { describe, expect, it } from "vitest";
import type { GameId, RealtimeGameId } from "@mpg/engine";
import {
  buildGameItems,
  buildHomeShelves,
  gameTags,
  hasTag,
  indexOfGame,
  nextGame,
  prevGame,
  GAME_CATALOG,
  REALTIME_CATALOG,
  type GameCatalogEntry,
  type GameItem,
  type HomeShelf,
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

describe("catalog — buildHomeShelves", () => {
  const ALL_GAMES: GameId[] = ["tictactoe", "connect4", "tictactoe-move", "nim", "gomoku"];
  const ALL_REALTIME: RealtimeGameId[] = ["floppy-birds", "drunk-walk", "reflex-test"];

  function shelf(shelves: HomeShelf[], id: string): HomeShelf | undefined {
    return shelves.find((s) => s.id === id);
  }

  function idsOn(shelves: HomeShelf[], id: string): string[] {
    return (shelf(shelves, id)?.entries ?? []).map((entry) => entry.id);
  }

  it("puts the curated entries on Featured, in catalog order", () => {
    const shelves = buildHomeShelves(ALL_GAMES, ALL_REALTIME);
    expect(idsOn(shelves, "featured")).toEqual([
      "tictactoe",
      "connect4",
      "floppy-birds",
      "drunk-walk",
    ]);
  });

  // The cold-start rule: with no play data, a shelf claiming to show what's
  // popular would be showing catalog order with a misleading label.
  it("omits the Trending shelf entirely when there is no ranking", () => {
    expect(shelf(buildHomeShelves(ALL_GAMES, ALL_REALTIME), "trending")).toBeUndefined();
    expect(
      shelf(buildHomeShelves(ALL_GAMES, ALL_REALTIME, { trending: [] }), "trending"),
    ).toBeUndefined();
  });

  it("orders Trending by the supplied ranking, not by catalog order", () => {
    const shelves = buildHomeShelves(ALL_GAMES, ALL_REALTIME, { trending: ["gomoku", "nim"] });
    expect(idsOn(shelves, "trending")).toEqual(["gomoku", "nim"]);
  });

  it("ignores a ranked id that isn't a listed game rather than breaking the shelf", () => {
    const shelves = buildHomeShelves(["nim"], [], { trending: ["connect4", "nim"] });
    expect(idsOn(shelves, "trending")).toEqual(["nim"]);
  });

  it("fills New with the most recent additions, newest first", () => {
    const shelves = buildHomeShelves(ALL_GAMES, ALL_REALTIME);
    // Featured already claimed the four oldest-but-curated entries; what's left
    // sorts by `addedOn` descending.
    expect(idsOn(shelves, "new")).toEqual(["reflex-test", "gomoku", "nim", "tictactoe-move"]);
  });

  // The invariant that makes curation safe: no amount of shelf editing can
  // strand a game, and no card is ever drawn twice on one page.
  it("places every listed game on exactly one shelf", () => {
    const shelves = buildHomeShelves(ALL_GAMES, ALL_REALTIME, { trending: ["nim"] });
    const ids = shelves.flatMap((s) => s.entries.map((entry) => entry.id));
    expect(ids).toHaveLength(ALL_GAMES.length + ALL_REALTIME.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls everything through to the catch-all shelf when nothing is curated", () => {
    const shelves = buildHomeShelves(["nim", "gomoku"], []);
    expect(shelf(shelves, "featured")).toBeUndefined();
    // `nim` and `gomoku` are the only two entries, so New takes both and the
    // catch-all is correctly dropped rather than rendered empty.
    expect(idsOn(shelves, "new")).toEqual(["gomoku", "nim"]);
    expect(shelf(shelves, "all")).toBeUndefined();
  });

  it("returns no shelves at all when no game is listed", () => {
    expect(buildHomeShelves([], [])).toEqual([]);
  });
});
