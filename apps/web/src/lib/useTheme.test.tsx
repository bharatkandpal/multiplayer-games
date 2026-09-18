import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useTheme } from "./useTheme";

function ThemeProbe(): React.JSX.Element {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <p data-testid="theme">{theme}</p>
      <p data-testid="resolved-theme">{resolvedTheme}</p>
      <button onClick={() => setTheme("dark")}>Set dark</button>
      <button onClick={() => setTheme("light")}>Set light</button>
      <button onClick={() => setTheme("system")}>Set system</button>
    </div>
  );
}

function mockMatchMedia(prefersDark: boolean): {
  listeners: Set<(e: MediaQueryListEvent) => void>;
  fire: (matches: boolean) => void;
} {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  let matches = prefersDark;

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: (_event: string, listener: (e: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: (e: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  return {
    listeners,
    fire: (next: boolean) => {
      matches = next;
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

describe("useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to system and resolves against the OS preference", () => {
    mockMatchMedia(true);
    render(<ThemeProbe />);

    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
  });

  it("sets an explicit theme, updates the DOM attribute, and persists it", async () => {
    const user = userEvent.setup();
    render(<ThemeProbe />);

    await user.click(screen.getByRole("button", { name: "Set dark" }));

    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("mpg.theme")).toBe("dark");
  });

  it("keeps 'system' settable — it stays the stored default even though the switch never writes it", async () => {
    const user = userEvent.setup();
    render(<ThemeProbe />);

    await user.click(screen.getByRole("button", { name: "Set dark" }));
    await user.click(screen.getByRole("button", { name: "Set system" }));

    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
    expect(window.localStorage.getItem("mpg.theme")).toBe("system");
  });

  it("re-resolves 'system' when the OS preference changes while mounted", () => {
    const media = mockMatchMedia(false);
    render(<ThemeProbe />);

    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");

    act(() => {
      media.fire(true);
    });

    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
  });

  it("restores a previously persisted theme on mount", () => {
    window.localStorage.setItem("mpg.theme", "dark");
    render(<ThemeProbe />);

    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
