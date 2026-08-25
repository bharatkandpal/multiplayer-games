import styles from "./Spinner.module.css";

/**
 * Decorative loading ring. Always pair with an accessible label/context
 * (e.g. Button's `aria-busy` + visible label, or a live-region message) —
 * this component itself is `aria-hidden`.
 */
export function Spinner(): React.JSX.Element {
  return <span className={styles.spinner} aria-hidden="true" />;
}
