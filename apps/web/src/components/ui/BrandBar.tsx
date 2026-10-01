import { BrandMark } from "./BrandMark";
import { cx } from "./cx";
import styles from "./BrandBar.module.css";

export interface BrandBarProps {
  /**
   * Trailing controls (theme switch today, the MPG-147 profile avatar next).
   * They sit at the end of the row and never shrink; the brand block gives way
   * first, so the bar keeps one fixed height at every width.
   */
  children?: React.ReactNode;
  className?: string | undefined;
}

/** What the product is, in one line. Static copy: no network dependency. */
export const BRAND_PROMISE = "Quick games, solo or with friends.";

/**
 * Home's top row (MPG-145): mark, wordmark, one-line promise, then whatever
 * controls the caller passes. The wordmark is the page's `h1`.
 */
export function BrandBar({ children, className }: BrandBarProps): React.JSX.Element {
  return (
    <div className={cx(styles.bar, className)}>
      <div className={styles.brand}>
        <BrandMark className={styles.mark} />
        <div className={styles.text}>
          <h1 className={styles.wordmark}>bkGames</h1>
          <p className={styles.promise}>{BRAND_PROMISE}</p>
        </div>
      </div>
      <div className={styles.controls}>{children}</div>
    </div>
  );
}
