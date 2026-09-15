import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { GAME_RULES, REALTIME_RULES } from "../screens/rules";
import { rulesSeenStorageKey } from "../hooks/useGameRules";

// vitest.config.ts does not enable `test.globals`, so @testing-library/react's
// automatic afterEach(cleanup) (which relies on a global `afterEach`) never
// registers. Do it explicitly so each test starts with a clean DOM.
afterEach(() => {
  cleanup();
});

// MPG-138: the how-to-play sheet opens by itself the first time a device sees a
// game, which would otherwise put a dialog over the board in the FIRST test of
// every play-screen file and not the rest — the ordering-dependent kind of
// failure that's worse than the bug it hides. Default every test to a player who
// has already read the rules; the tests that cover the auto-open clear these
// keys themselves.
beforeEach(() => {
  for (const gameId of [...Object.keys(GAME_RULES), ...Object.keys(REALTIME_RULES)]) {
    window.localStorage.setItem(rulesSeenStorageKey(gameId), "1");
  }
});

// jsdom does not implement matchMedia. Provide a default stub (matching
// nothing / "light") so components that read prefers-color-scheme (e.g. the
// theme hook) don't crash in tests that don't care about it. Tests that do
// care (src/lib/useTheme.test.tsx) override this per-test.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
