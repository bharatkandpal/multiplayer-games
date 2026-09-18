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

/** Circled question mark — "help" / "how does this work". */
export function HelpIcon(props: IconProps): React.JSX.Element {
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
      <circle cx={12} cy={12} r={9} />
      {/* The hook and stem of the "?", drawn rather than set as text so it
          keeps the same stroke weight as every other icon here. */}
      <path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4" />
      <path d="M12 17.3h.01" />
    </svg>
  );
}

/** Two crossing arrows — "shuffle" / "re-roll". Used by the username badge to
 * spin up a fresh adjective+animal default. */
export function ShuffleIcon(props: IconProps): React.JSX.Element {
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
      <path d="M4 6h3.5l9 12H20" />
      <path d="M16.5 15.5L20 18l-3.5 2.5" />
      <path d="M4 18h3.5l2.4-3.2" />
      <path d="M14.1 9.2L16.5 6H20" />
      <path d="M16.5 3.5L20 6l-3.5 2.5" />
    </svg>
  );
}

const SUN_RAY_COUNT = 8;
const SUN_CORE_R = 4.2;
const SUN_RAY_INNER_R = 6.6;
const SUN_RAY_OUTER_R = 9.2;

/** Sun — the light half of the theme switch. Rays are computed from
 * `SUN_RAY_COUNT` so the glyph stays evenly spoked; at the 14px the switch
 * renders it at, an eight-ray sun still reads as a sun and not a snowflake. */
export function SunIcon(props: IconProps): React.JSX.Element {
  const rays = Array.from({ length: SUN_RAY_COUNT }, (_, i) => {
    const angle = ((2 * Math.PI) / SUN_RAY_COUNT) * i;
    const x1 = 12 + SUN_RAY_INNER_R * Math.cos(angle);
    const y1 = 12 + SUN_RAY_INNER_R * Math.sin(angle);
    const x2 = 12 + SUN_RAY_OUTER_R * Math.cos(angle);
    const y2 = 12 + SUN_RAY_OUTER_R * Math.sin(angle);
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
      <circle cx={12} cy={12} r={SUN_CORE_R} />
      {rays}
    </svg>
  );
}

/** Crescent moon — the dark half of the theme switch. One filled path rather
 * than a stroked outline: at icon size a stroked crescent's two tips collapse
 * into a blob, while a solid one keeps its silhouette. */
export function MoonIcon(props: IconProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z" />
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
