import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./StatusBadge.module.css";

export type StatusBadgeStatus = "neutral" | "success" | "danger" | "warning" | "info";

export interface StatusBadgeProps {
  status: StatusBadgeStatus;
  children: ReactNode;
  className?: string | undefined;
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
export function StatusBadge({ status, children, className }: StatusBadgeProps): React.JSX.Element {
  return (
    <span className={cx(styles.badge, styles[status], className)}>
      <span className={styles.icon} aria-hidden="true">
        {STATUS_ICON[status]}
      </span>
      {children}
    </span>
  );
}
