import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The share fallback ladder (MPG-087), as one reusable hook.
 *
 * Sharing is the north-star loop's last step, and it has to work on every
 * surface it's offered on — so this degrades rather than dead-ends:
 *
 *   1. `navigator.share` — the native sheet. Mobile's one-tap path.
 *   2. `navigator.clipboard.writeText`, then a legacy `execCommand("copy")`
 *      textarea — the desktop path, and mobile's path outside a secure context.
 *   3. `"unavailable"` — the caller shows the raw URL, selectable. Never a
 *      dead end, just a manual one.
 *
 * Two behaviours that are easy to get wrong and are the point of centralizing
 * this: a user DISMISSING the native share sheet is a cancel, not a failure
 * (it rejects with `AbortError`, and reporting "couldn't share" there would be
 * a lie), and `navigator.share` requires a secure context — so its mere
 * presence isn't enough, a real rejection must still fall through to copy.
 */

export type ShareStatus =
  | "idle"
  /** Native sheet is open — the user hasn't chosen or cancelled yet. */
  | "sharing"
  | "shared"
  | "copied"
  /** Every automatic path failed; the caller must surface the URL to copy by hand. */
  | "unavailable";

export interface ShareLinkPayload {
  readonly url: string;
  readonly title?: string;
  readonly text?: string;
}

export interface UseShareLinkOptions {
  /**
   * How long a transient success status ("shared"/"copied") stays before
   * returning to idle. `"unavailable"` deliberately never auto-clears — it's
   * an escape hatch, and yanking it away would strand the user.
   */
  readonly resetMs?: number;
}

export interface UseShareLinkResult {
  readonly share: (payload: ShareLinkPayload) => Promise<void>;
  readonly status: ShareStatus;
  /**
   * Whether a native share sheet exists on this platform. Callers use it to
   * label the affordance honestly ("Share" vs "Copy link") — the ladder works
   * either way, but the button shouldn't promise a sheet that won't appear.
   */
  readonly canShare: boolean;
  readonly reset: () => void;
}

/** True only where a native share sheet is actually reachable. */
function detectNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** Clipboard write with the legacy `execCommand` path behind it. Never throws. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      return true;
    } catch {
      return false;
    }
  }
}

export function useShareLink(options: UseShareLinkOptions = {}): UseShareLinkResult {
  const { resetMs = 2000 } = options;
  const [status, setStatus] = useState<ShareStatus>("idle");
  // Capability is fixed for the page's lifetime; reading it once keeps the
  // button's label from flipping mid-interaction.
  const [canShare] = useState(detectNativeShare);
  const timerRef = useRef<number | undefined>(undefined);

  const clearTimer = (): void => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  };

  useEffect(() => clearTimer, []);

  const reset = useCallback((): void => {
    clearTimer();
    setStatus("idle");
  }, []);

  const share = useCallback(
    async (payload: ShareLinkPayload): Promise<void> => {
      clearTimer();
      // Optimistic, synchronous state change so the button acknowledges the
      // press immediately — well inside the 100ms feedback budget — instead of
      // waiting on the clipboard or the OS sheet to come back.
      setStatus("sharing");

      const settle = (next: ShareStatus): void => {
        setStatus(next);
        if (next === "shared" || next === "copied") {
          timerRef.current = window.setTimeout(() => setStatus("idle"), resetMs);
        }
      };

      if (canShare) {
        try {
          await navigator.share({
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.text !== undefined ? { text: payload.text } : {}),
            url: payload.url,
          });
          settle("shared");
          return;
        } catch (error) {
          // The user closed the sheet. Nothing failed and nothing was shared —
          // go quietly back to idle rather than showing an error or silently
          // copying something they just declined to send.
          if (error instanceof Error && error.name === "AbortError") {
            settle("idle");
            return;
          }
          // Anything else (insecure context, unsupported payload, a platform
          // that advertises `share` but refuses it) falls through to copy.
        }
      }

      settle((await copyToClipboard(payload.url)) ? "copied" : "unavailable");
    },
    [canShare, resetMs],
  );

  return { share, status, canShare, reset };
}
