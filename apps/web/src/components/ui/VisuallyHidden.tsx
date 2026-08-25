import type { ReactNode } from "react";
import styles from "./VisuallyHidden.module.css";

export interface VisuallyHiddenProps {
  children: ReactNode;
}

/**
 * Renders content that is present for assistive technology (screen readers)
 * but not shown visually — e.g. supplementary labels/announcements that
 * would be redundant or noisy on-screen. Uses the standard "clip" technique
 * (not `display: none`/`visibility: hidden`, which would hide it from AT too).
 */
export function VisuallyHidden({ children }: VisuallyHiddenProps): React.JSX.Element {
  return <span className={styles.root}>{children}</span>;
}
