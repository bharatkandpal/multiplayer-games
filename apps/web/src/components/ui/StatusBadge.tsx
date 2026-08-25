import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./StatusBadge.module.css";

export type StatusBadgeStatus = "neutral" | "success" | "danger" | "warning" | "info";

export interface StatusBadgeProps {
  status: StatusBadgeStatus;
  children: ReactNode;
  className?: string | undefined;
  /**
   * Shows a small pulsing dot-group after the label to indicate an
   * in-progress background action (e.g. a bot "thinking"). Purely
   * decorative — the label text (and any live-region announcement) carries
   * the actual meaning; honors `prefers-reduced-motion` (dots go static).
   */
  busy?: boolean;
}

/**
 * Per-status glyph so meaning never depends on color alone (UX_PRINCIPLES
 * §4 — "never rely on color alone"). Purely decorative; the label text
 * carries the actual meaning for assistive tech.
 */
const STATUS_ICON: Record<StatusBadgeStatus, string> = {
  neutral: "●", // ●
  success: "✓", // ✓
  danger: "✕", // ✕
  warning: "⚠", // ⚠
  info: "ℹ", // ℹ
};

/**
 * Small labeled status pill, e.g. "Connected", "Your turn", "Draw". Never
 * color-only: pairs a semantic color token with a distinct icon glyph and
 * requires a text label.
 */
export function StatusBadge({
  status,
  children,
  className,
  busy = false,
}: StatusBadgeProps): React.JSX.Element {
  return (
    <span className={cx(styles.badge, styles[status], className)}>
      <span className={styles.icon} aria-hidden="true">
        {STATUS_ICON[status]}
      </span>
      {children}
      {busy ? (
        <span className={styles.thinkingDots} aria-hidden="true">
          <span className={styles.thinkingDot} />
          <span className={styles.thinkingDot} />
          <span className={styles.thinkingDot} />
        </span>
      ) : null}
    </span>
  );
}
