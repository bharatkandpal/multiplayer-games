import type { SVGProps } from "react";

/**
 * The bkGames mark (MPG-145). Placeholder-quality on purpose: a rounded plum
 * tile holding two pieces, one round and one square, so the two sides are told
 * apart by shape rather than hue (the same rule the boards follow). Kept as its
 * own component so a real logo can replace it without touching the bar.
 *
 * Decorative: the wordmark beside it carries the name, so it is `aria-hidden`.
 */
export function BrandMark(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 32 32"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect width={32} height={32} rx={8} fill="var(--color-accent)" />
      <circle cx={11.5} cy={11.5} r={4.5} fill="var(--color-on-accent)" />
      <rect
        x={16}
        y={16}
        width={9}
        height={9}
        rx={2}
        fill="none"
        stroke="var(--color-on-accent)"
        strokeWidth={2.5}
      />
    </svg>
  );
}
