import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.ts does not enable `test.globals`, so @testing-library/react's
// automatic afterEach(cleanup) (which relies on a global `afterEach`) never
// registers. Do it explicitly so each test starts with a clean DOM.
afterEach(() => {
  cleanup();
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
