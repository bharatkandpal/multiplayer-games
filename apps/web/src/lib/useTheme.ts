import { useCallback, useEffect, useState } from "react";
import {
  type Theme,
  applyTheme,
  getStoredTheme,
  getSystemPrefersDark,
  resolveTheme,
  setTheme as persistTheme,
} from "./theme";

export interface UseThemeResult {
  /** The user's chosen theme preference: "light" | "dark" | "system". */
  theme: Theme;
  /** The theme actually applied right now ("system" resolved against the OS). */
  resolvedTheme: "light" | "dark";
  /** Sets and persists a new theme preference. */
  setTheme: (theme: Theme) => void;
}

/**
 * React hook for reading/setting the app theme. Keeps `<html data-theme>` in
 * sync with the returned state, persists explicit choices, and re-resolves
 * "system" when the OS preference changes while the app is open.
 */
export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    resolveTheme(getStoredTheme()),
  );

  useEffect(() => {
    applyTheme(theme);
    setResolvedTheme(resolveTheme(theme));
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return undefined;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (): void => {
      setResolvedTheme(getSystemPrefersDark() ? "dark" : "light");
    };

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    persistTheme(next);
    setThemeState(next);
  }, []);

  return { theme, resolvedTheme, setTheme };
}
