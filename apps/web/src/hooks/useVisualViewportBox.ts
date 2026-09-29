import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * Pin a `position: fixed` element to the *visual* viewport rather than the
 * layout viewport.
 *
 * A phone's on-screen keyboard shrinks the visual viewport but leaves the
 * layout viewport (the box `position: fixed; inset: 0` sizes against) at full
 * height. The browser then scrolls to reveal the focused field, which pushes a
 * full-screen fixed sheet's top — the chat header, in our case — up and out of
 * sight above the keyboard. `interactive-widget=resizes-content` fixes this on
 * Chrome Android but iOS Safari doesn't support it, so we track
 * `window.visualViewport` directly and works everywhere the API exists.
 *
 * We size the element to `visualViewport.height` and translate it down by
 * `visualViewport.offsetTop` (how far the visual viewport has scrolled within
 * the layout viewport), so the whole sheet stays inside the space above the
 * keyboard. Left/right are left to the element's own `inset`.
 *
 * Degrades to absence: with no `visualViewport` (older browsers, SSR) or while
 * `enabled` is false, the element keeps its CSS-defined box untouched.
 */
export function useVisualViewportBox(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!enabled || !vv) return undefined;

    const apply = (): void => {
      const el = ref.current;
      if (!el) return;
      el.style.height = `${vv.height}px`;
      el.style.transform = `translateY(${vv.offsetTop}px)`;
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      // Hand the box back to CSS when chat closes, so nothing stale lingers.
      const el = ref.current;
      if (el) {
        el.style.height = "";
        el.style.transform = "";
      }
    };
  }, [ref, enabled]);
}
