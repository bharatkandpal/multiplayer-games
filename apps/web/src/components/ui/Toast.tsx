import { useEffect, useRef } from "react";
import type { FocusEvent, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Toast.module.css";

export type ToastVariant = "neutral" | "success" | "danger" | "warning" | "info";

export interface ToastProps {
  variant?: ToastVariant;
  children: ReactNode;
  /** Called when the user dismisses the toast, or when `autoDismissMs` elapses. */
  onDismiss?: () => void;
  /** Accessible label for the dismiss button. Defaults to "Dismiss". */
  dismissLabel?: string;
  /**
   * If set, the toast calls `onDismiss` automatically after this many ms.
   * The timer pauses while hovered or focused (WCAG 2.2.1) and resumes with
   * the remaining time on mouse-leave/blur.
   */
  autoDismissMs?: number;
  className?: string | undefined;
}

const ICON: Record<ToastVariant, string> = {
  neutral: "●",
  success: "✓",
  danger: "✕",
  warning: "⚠",
  info: "ℹ",
};

/**
 * Transient message. `danger`/`warning` use `role="alert"` (assertive,
 * interrupts) since they represent something that went wrong; the rest use
 * `role="status"` (polite) per UX_PRINCIPLES §2/§4 — announced to screen
 * readers without needing focus to move.
 */
export function Toast({
  variant = "info",
  children,
  onDismiss,
  dismissLabel = "Dismiss",
  autoDismissMs,
  className,
}: ToastProps): React.JSX.Element {
  const role = variant === "danger" || variant === "warning" ? "alert" : "status";

  const timeoutRef = useRef<number | undefined>(undefined);
  const remainingRef = useRef<number | undefined>(autoDismissMs);
  const startedAtRef = useRef<number>(0);

  const clearTimer = (): void => {
    if (timeoutRef.current === undefined) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
  };

  const startTimer = (ms: number): void => {
    if (!onDismiss) return;
    startedAtRef.current = Date.now();
    timeoutRef.current = window.setTimeout(onDismiss, ms);
  };

  useEffect(() => {
    remainingRef.current = autoDismissMs;
    if (autoDismissMs === undefined || !onDismiss) return undefined;
    startTimer(autoDismissMs);
    return () => clearTimer();
  }, [autoDismissMs, onDismiss]);

  // Pause on hover/focus, resume with the remaining time on leave/blur —
  // WCAG 2.2.1 (Timing Adjustable): don't force a countdown the user can't
  // pause while they're reading or interacting with it.
  const pause = (): void => {
    if (autoDismissMs === undefined || !onDismiss || timeoutRef.current === undefined) return;
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(0, (remainingRef.current ?? autoDismissMs) - elapsed);
    clearTimer();
  };

  const resume = (): void => {
    if (autoDismissMs === undefined || !onDismiss || timeoutRef.current !== undefined) return;
    startTimer(remainingRef.current ?? autoDismissMs);
  };

  const handleFocus = (_event: FocusEvent<HTMLDivElement>): void => pause();
  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    // Only resume once focus has left the toast entirely (not moved between
    // its own children, e.g. from the message to the dismiss button).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    resume();
  };

  return (
    <div
      className={cx(styles.toast, styles[variant], className)}
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <span className={styles.icon} aria-hidden="true">
        {ICON[variant]}
      </span>
      <div className={styles.body}>{children}</div>
      {onDismiss ? (
        <button
          type="button"
          className={styles.dismiss}
          onClick={onDismiss}
          aria-label={dismissLabel}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}
