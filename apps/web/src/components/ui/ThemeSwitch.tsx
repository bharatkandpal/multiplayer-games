import { cx } from "./cx";
import { MoonIcon, SunIcon } from "./icons";
import styles from "./ThemeSwitch.module.css";

export interface ThemeSwitchProps {
  /**
   * Whether dark is what's on screen right now — i.e. `resolvedTheme`, not the
   * stored preference. A visitor whose stored theme is still "system" on a
   * dark-mode phone sees the switch already on, which is the truth.
   */
  dark: boolean;
  /**
   * The theme the player just asked for. Only ever "light" or "dark": the
   * switch has two states, so it can only ever express two. "system" survives
   * as the stored default in `lib/theme.ts` — this control just never writes it.
   */
  onChange: (theme: "light" | "dark") => void;
  className?: string | undefined;
}

/**
 * Two-state theme switch (MPG-144), replacing the three-way `Theme: System
 * (light)` cycler that needed up to three presses to undo one and packed two
 * pieces of state into one label.
 *
 * Both icons are always visible and the knob's **position** carries the state,
 * so the control is readable without relying on hue — and readable in the very
 * theme it's about to change. `role="switch"` + `aria-checked` is what gives
 * assistive tech the on/off reading for free; the name is "Dark mode", so
 * checked means dark with no further explanation needed.
 */
export function ThemeSwitch({ dark, onChange, className }: ThemeSwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      className={cx(styles.switch, className)}
      onClick={() => onChange(dark ? "light" : "dark")}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.knob} />
        <span className={cx(styles.slot, styles.sun, !dark && styles.slotActive)}>
          <SunIcon />
        </span>
        <span className={cx(styles.slot, styles.moon, dark && styles.slotActive)}>
          <MoonIcon />
        </span>
      </span>
    </button>
  );
}
