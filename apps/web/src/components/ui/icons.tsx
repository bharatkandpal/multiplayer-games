import type { SVGProps } from "react";

/**
 * Small inline icon set for controls that need a glyph instead of (or in
 * addition to) text. Deliberately tiny — add to this file rather than
 * pulling in an icon library; the platform only needs a handful of these.
 * `currentColor` throughout so icons inherit the button's text color across
 * variants/states for free, and size follows `font-size` (1em) so callers
 * scale them the same way they'd scale text.
 */

export type IconProps = SVGProps<SVGSVGElement>;

/** Leftward chevron — "go back". */
export function BackArrowIcon(props: IconProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/** House glyph — "home". */
export function HomeIcon(props: IconProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 11.5L12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}
