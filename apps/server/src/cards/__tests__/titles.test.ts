import { describe, expect, it, beforeEach } from "vitest";

import {
  clearRegistry,
  clearRealtimeRegistry,
  listGames,
  listRealtimeGames,
  registerBuiltInGames,
  registerBuiltInRealtimeGames,
} from "@mpg/engine";

import { GAME_TITLES, gameTitle } from "../titles.js";

/**
 * The card's title table duplicates `apps/web/src/screens/catalog.ts` because the
 * import boundary runs one way. This test is what keeps the duplicate complete: add a
 * game to the engine without adding a title here, and it fails — before anyone ships a
 * card labelled `some-new-game`.
 */
describe("card titles cover every registered game", () => {
  beforeEach(() => {
    clearRegistry();
    clearRealtimeRegistry();
    registerBuiltInGames();
    registerBuiltInRealtimeGames();
  });

  it("has a title for every turn-based game", () => {
    const missing = listGames().filter((id) => !(id in GAME_TITLES));
    expect(missing).toEqual([]);
  });

  it("has a title for every real-time game", () => {
    // `RealtimeGameId` includes ids that aren't built yet (e.g. lumberjack), so this
    // checks what is REGISTERED, not what the union permits.
    const missing = listRealtimeGames().filter((id) => !(id in GAME_TITLES));
    expect(missing).toEqual([]);
  });

  it("falls back to the raw id rather than refusing to name the game", () => {
    expect(gameTitle("drunk-walk")).toBe("Drunk Walk");
    expect(gameTitle("not-a-game")).toBe("not-a-game");
  });
});
