import { cx } from "./cx";
import styles from "./Avatar.module.css";

export interface AvatarProps {
  /** The player's name; the only input. Art can change behind this seam later. */
  name: string;
  className?: string | undefined;
}

/**
 * Up to two initials from a name. camelCase auto names ("strongWolf") split on
 * the capital, so they read "SW"; anything else takes its first two characters.
 */
export function initialsOf(name: string): string {
  const words = name.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [];
  const letters =
    words.length >= 2
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2);
  return (letters || "?").toUpperCase();
}

/**
 * Decorative disc standing for a player. Takes a name and returns a rendering,
 * so animal-glyph art can replace the initials later without touching callers.
 * It is `aria-hidden`: the control that hosts it carries the accessible name.
 */
export function Avatar({ name, className }: AvatarProps): React.JSX.Element {
  return (
    <span className={cx(styles.avatar, className)} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}
