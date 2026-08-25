import { VisuallyHidden } from "./VisuallyHidden";
import { cx } from "./cx";
import styles from "./Skeleton.module.css";

export type SkeletonVariant = "text" | "circle" | "rect";

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string | undefined;
}

function toCssSize(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * A single loading placeholder shape. Purely decorative (`aria-hidden`) —
 * wrap one or more in `<SkeletonGroup>` to give the loading state an
 * accessible announcement (UX_PRINCIPLES §2: "loading" must never be a bare,
 * context-free spinner/placeholder for screen-reader users either).
 */
export function Skeleton({
  variant = "text",
  width,
  height,
  className,
}: SkeletonProps): React.JSX.Element {
  return (
    <span
      className={cx(styles.skeleton, styles[variant], className)}
      style={{ width: toCssSize(width), height: toCssSize(height) }}
      aria-hidden="true"
    />
  );
}

export interface SkeletonGroupProps {
  children: React.ReactNode;
  /** Announced once to screen readers for the whole group. */
  label?: string;
  className?: string | undefined;
}

/**
 * Groups one or more `Skeleton` placeholders under a single
 * `role="status"` live region so assistive tech hears "Loading…" once,
 * rather than per-shape noise.
 */
export function SkeletonGroup({
  children,
  label = "Loading…",
  className,
}: SkeletonGroupProps): React.JSX.Element {
  return (
    <div className={className} role="status" aria-live="polite">
      <VisuallyHidden>{label}</VisuallyHidden>
      {children}
    </div>
  );
}
