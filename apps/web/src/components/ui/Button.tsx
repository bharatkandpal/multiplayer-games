import type { ComponentPropsWithRef, MouseEvent } from "react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import { VisuallyHidden } from "./VisuallyHidden";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ComponentPropsWithRef<"button">, "type"> {
  /** Visual style. Defaults to "primary" (the one clear action per screen). */
  variant?: ButtonVariant;
  /** Defaults to "md". All sizes keep a >= 44px touch target. */
  size?: ButtonSize;
  /**
   * Shows an inline spinner, sets `aria-busy`, and blocks activation so the
   * action can't be double-fired while in flight. Deliberately does NOT use
   * the native `disabled` attribute for this (that would yank keyboard/SR
   * focus to `<body>` at the exact moment the user needs reassurance) —
   * instead the button stays focusable with `aria-disabled="true"` and the
   * click handler is a no-op. The visible label stays put (never replaced
   * by a bare spinner) — see UX_PRINCIPLES §2 "Loading".
   */
  loading?: boolean;
  /** Native `type`; defaults to "button" (buttons rarely want the implicit
   * form-submit behavior, and an explicit default avoids surprises). */
  type?: "button" | "submit" | "reset";
  /** Announced only to assistive tech while loading, e.g. "Saving…". */
  loadingLabel?: string;
}

/**
 * Core action control. Implements the full interaction-state set required by
 * UX_PRINCIPLES §3: hover/active/focus-visible, disabled, and a loading
 * state that is `aria-busy` + visually indicated + still keyboard-inert.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  type = "button",
  loadingLabel = "Loading",
  className,
  children,
  onClick,
  ...rest
}: ButtonProps): React.JSX.Element {
  // `disabled` is a real, native-disabled state. `loading` (when not also
  // `disabled`) intentionally stays focusable — see the `loading` prop doc.
  const isBlockedByLoading = loading && !disabled;

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (isBlockedByLoading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        styles[size],
        loading && styles.loading,
        className,
      )}
      disabled={disabled}
      aria-disabled={isBlockedByLoading ? true : undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      <span className={styles.label}>{children}</span>
      {loading ? <VisuallyHidden>{loadingLabel}</VisuallyHidden> : null}
    </button>
  );
}
