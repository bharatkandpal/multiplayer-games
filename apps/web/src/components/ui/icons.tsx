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

const GEAR_CENTER = { x: 12, y: 12 };
const GEAR_RING_R = 6.4;
const GEAR_TOOTH_OUTER_R = 8.8;
const GEAR_HOLE_R = 2.4;
const GEAR_TOOTH_COUNT = 8;

/** Gear/cog glyph — "settings" / "customize". A ring (the gear body) with a
 * small hole punched out (the bolt) and short teeth nubbed evenly around the
 * outside — computed from `GEAR_TOOTH_COUNT` rather than hand-picked
 * coordinates, so it's an actual toothed cog silhouette (not a compass/sun
 * asterisk, which a bare spokes-from-center version reads as). */
export function GearIcon(props: IconProps): React.JSX.Element {
  const teeth = Array.from({ length: GEAR_TOOTH_COUNT }, (_, i) => {
    const angle = ((2 * Math.PI) / GEAR_TOOTH_COUNT) * i;
    const x1 = GEAR_CENTER.x + GEAR_RING_R * Math.cos(angle);
    const y1 = GEAR_CENTER.y + GEAR_RING_R * Math.sin(angle);
    const x2 = GEAR_CENTER.x + GEAR_TOOTH_OUTER_R * Math.cos(angle);
    const y2 = GEAR_CENTER.y + GEAR_TOOTH_OUTER_R * Math.sin(angle);
    // Fixed-count, order-stable geometry (not a dynamic list) — index as key is fine.
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
  });

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
      <circle cx={GEAR_CENTER.x} cy={GEAR_CENTER.y} r={GEAR_RING_R} />
      <circle cx={GEAR_CENTER.x} cy={GEAR_CENTER.y} r={GEAR_HOLE_R} />
      {teeth}
    </svg>
  );
}
