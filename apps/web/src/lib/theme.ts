/**
 * Theme utility (MPG-029-b).
 *
 * Reads/writes the `data-theme` attribute on `<html>` (the hook
 * ../styles/tokens.css switches light/dark on) and persists the user's
 * explicit choice, defaulting to "system" (follow the OS via
 * `prefers-color-scheme`).
 */

export type Theme = "light" | "dark" | "system";

const THEME_ATTR = "data-theme";
const STORAGE_KEY = "mpg.theme";
const VALID_THEMES: readonly Theme[] = ["light", "dark", "system"];

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (VALID_THEMES as readonly string[]).includes(value);
}

/** Reads the persisted theme choice, falling back to "system". */
export function getStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    // localStorage can throw (privacy mode, disabled storage, …) — fall back
    // gracefully rather than breaking theming.
    return "system";
  }
}

/** Applies a theme to `<html data-theme="...">` without persisting it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute(THEME_ATTR, theme);
}

/** Applies a theme and persists the choice for future visits. */
export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Best-effort persistence only; the theme is still applied for this
    // session even if storage is unavailable.
  }
}

/** Reads the OS-level color scheme preference. */
export function getSystemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/**
 * The theme that is actually rendered right now: "system" resolves to
 * whatever the OS currently prefers.
 */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return getSystemPrefersDark() ? "dark" : "light";
  }
  return theme;
}

/** Initializes `<html data-theme>` from the persisted/default theme. Call once at app startup. */
export function initTheme(): Theme {
  const theme = getStoredTheme();
  applyTheme(theme);
  return theme;
}
