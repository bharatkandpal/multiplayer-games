/**
 * Tiny classname joiner. Kept local (no external dependency) — filters out
 * falsy values so components can compose CSS Module class names conditionally
 * without reaching for a library.
 */
export function cx(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}
