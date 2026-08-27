import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Reactive read of the user's `prefers-reduced-motion` setting.
 *
 * CSS-only surfaces (see `GamePlayScreen.module.css`) can honor the preference
 * with a media query alone, but a JS-driven renderer (the real-time arcade
 * canvas, ADR 0002 §5) needs the value at runtime to drop decorative
 * parallax/particles. This hook exposes it and updates live if the OS setting
 * changes mid-session. SSR/no-`matchMedia` environments default to `false`
 * (motion allowed) — the safe default for a game whose core loop *is* motion.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const onChange = (): void => setReduced(mql.matches);
    onChange(); // sync in case it changed between initial state and effect
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
