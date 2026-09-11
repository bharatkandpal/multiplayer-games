/**
 * SVG building blocks for the share card, and the three places determinism is easy to
 * lose without noticing.
 *
 * The card's whole contract is "same result in, byte-identical card out" — that is what
 * lets MPG-085-b cache a rendered card as immutable forever. Ordinary-looking JavaScript
 * breaks it in ways that only show up across machines:
 *
 *  1. **`toLocaleString`** formats by the host's locale: `1,234` here, `1.234` on a
 *     server in Berlin. `formatCount` groups digits by hand instead.
 *  2. **`Date` formatting** reads the host's timezone, so the same result renders a
 *     different date either side of midnight UTC. `formatUtcDate` pins it to UTC.
 *  3. **Float coordinates** print at full precision (`183.33333333333334`), which is
 *     stable but enormous and noisy. `n()` rounds to 2dp — enough for a 1200px canvas
 *     to be pixel-exact, and it keeps the output diffable.
 *
 * There is deliberately no template engine and no DOM here: string concatenation is the
 * most predictable thing available, and the output is small enough to read.
 */

/** Standard Open Graph / `summary_large_image` canvas. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/**
 * XML-escapes text destined for a `<text>` body or an attribute value.
 *
 * Card content is server-derived today (game titles from our own table, numbers from
 * our own columns), so nothing here is currently attacker-controlled. It is escaped
 * anyway because that will not stay true — MPG-091 puts player handles on results, and
 * the first unescaped `&` in a handle would produce not an injection but a card that
 * fails to parse at all, i.e. a silently broken unfurl.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Rounds a coordinate to 2dp and strips the trailing `.0`/`.00` an integer would get. */
export function n(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  // `Object.is` catches -0, which would otherwise print as "0" on one path and "-0" on
  // another depending on how the coordinate was derived.
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Groups an integer with commas, locale-independently: `2481` → `2,481`.
 *
 * Non-integers are rounded first. A score is a count in every game in the catalogue
 * today (Drunk Walk's distance advances 1 per tick), but nothing in `GameResult`
 * enforces that, and `2481.0000000001` on a card would look like a bug.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value);
  const negative = rounded < 0;
  const digits = String(Math.abs(rounded));
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    // Comma before every third digit counting from the right, never leading.
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return negative ? `-${out}` : out;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * `12 Sep 2026`, always in UTC.
 *
 * UTC rather than the viewer's zone because a card is rendered once, on a server, and
 * then cached forever and shown to everyone — there is no viewer to localise for at
 * render time, and reading the *server's* zone would make the output depend on where it
 * happened to run.
 */
export function formatUtcDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * `1m 43s` / `12s`. Used where a result carries a duration worth bragging about.
 * Hours are folded into minutes on purpose: a card showing `2h 05m` is a card about a
 * tab someone left open, not a run.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export interface TextOptions {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly fill: string;
  readonly weight?: number;
  /** Extra letter-spacing, for the micro-caps eyebrow voice. */
  readonly tracking?: number;
  readonly anchor?: "start" | "middle" | "end";
  /** Use the data/mono voice — mandatory for scores, times and ranks. */
  readonly mono?: boolean;
}

/**
 * Font stacks, mirroring `--font-family-*` in `tokens.css`.
 *
 * `DESIGN_LANGUAGE` §3 commits to no webfont, which is right for the app and slightly
 * awkward here: a rasteriser running on a server has none of these faces installed, so
 * it will fall through to whatever generic it can resolve. That is a **rasterisation**
 * concern, not a rendering one — the SVG this module emits is byte-identical either way
 * — and it belongs to MPG-085-b along with the rasteriser choice. Noted rather than
 * solved here, because solving it means shipping a font binary, which is a dependency
 * decision this slice deliberately does not take.
 */
const FONT_DISPLAY = "ui-rounded, 'Segoe UI Variable', Nunito, system-ui, sans-serif";
const FONT_MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

/** One `<text>` element. `tabular-nums` is mandatory on the data voice per §3. */
export function text(content: string, opts: TextOptions): string {
  const attrs = [
    `x="${n(opts.x)}"`,
    `y="${n(opts.y)}"`,
    `fill="${opts.fill}"`,
    `font-family="${escapeXml(opts.mono ? FONT_MONO : FONT_DISPLAY)}"`,
    `font-size="${n(opts.size)}"`,
    `font-weight="${opts.weight ?? 700}"`,
  ];
  if (opts.tracking !== undefined) attrs.push(`letter-spacing="${n(opts.tracking)}"`);
  if (opts.anchor && opts.anchor !== "start") attrs.push(`text-anchor="${opts.anchor}"`);
  if (opts.mono) attrs.push(`font-variant-numeric="tabular-nums"`);
  return `<text ${attrs.join(" ")}>${escapeXml(content)}</text>`;
}

export interface RectOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly rx?: number;
  readonly opacity?: number;
}

export function rect(opts: RectOptions): string {
  const attrs = [
    `x="${n(opts.x)}"`,
    `y="${n(opts.y)}"`,
    `width="${n(opts.width)}"`,
    `height="${n(opts.height)}"`,
    `fill="${opts.fill}"`,
  ];
  if (opts.rx !== undefined) attrs.push(`rx="${n(opts.rx)}"`);
  if (opts.opacity !== undefined) attrs.push(`opacity="${n(opts.opacity)}"`);
  return `<rect ${attrs.join(" ")} />`;
}

export function path(d: string, fill: string, opacity?: number): string {
  const extra = opacity !== undefined ? ` opacity="${n(opacity)}"` : "";
  return `<path d="${d}" fill="${fill}"${extra} />`;
}

export function circle(cx: number, cy: number, r: number, fill: string): string {
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" />`;
}

/**
 * A thick segment, emitted as a **filled** quad with round caps rather than a stroked
 * `<line>` or `<path>`.
 *
 * This looks like the long way round, and it is deliberate. Reviewing the first rendered
 * cards showed macOS Quick Look drawing every filled shape and silently dropping every
 * stroked one — the whole Drunk Walk figure vanished while the card still passed all its
 * string assertions. Quick Look is a weak renderer and a good rasteriser handles strokes
 * fine, but two things follow from it:
 *
 *  1. MPG-085-b has not picked a rasteriser yet, so the card cannot assume a strong one.
 *     Fills are the most universally supported thing in SVG; a card built only from
 *     fills has the widest possible chance of rendering identically everywhere.
 *  2. A card that fails to draw is indistinguishable from one that drew correctly, as
 *     far as any string-based test can tell. Removing the feature that can silently
 *     fail is better than testing for it.
 *
 * Geometry: the segment becomes a rectangle rotated to its own angle, plus a circle at
 * each end for the cap. Purely arithmetic, so it stays byte-identical per input.
 */
export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fill: string,
  width = 1,
  opacity?: number,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return "";

  // Unit normal, scaled to half the segment's thickness.
  const hx = (-dy / len) * (width / 2);
  const hy = (dx / len) * (width / 2);

  const quad =
    `M ${n(x1 + hx)} ${n(y1 + hy)} L ${n(x2 + hx)} ${n(y2 + hy)} ` +
    `L ${n(x2 - hx)} ${n(y2 - hy)} L ${n(x1 - hx)} ${n(y1 - hy)} Z`;

  const parts = [path(quad, fill, opacity)];
  // Round caps, only where they'd actually be visible.
  if (width > 3) {
    parts.push(circleOpaque(x1, y1, width / 2, fill, opacity));
    parts.push(circleOpaque(x2, y2, width / 2, fill, opacity));
  }
  return parts.join("");
}

function circleOpaque(cx: number, cy: number, r: number, fill: string, opacity?: number): string {
  const extra = opacity !== undefined ? ` opacity="${n(opacity)}"` : "";
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${extra} />`;
}

/** An ellipse — used for the figure's ground shadow. Filled, like everything else. */
export function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string,
  opacity?: number,
): string {
  const extra = opacity !== undefined ? ` opacity="${n(opacity)}"` : "";
  return (
    `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" ` +
    `fill="${fill}"${extra} />`
  );
}

/** A horizontal hairline as a `<rect>`, so it needs no stroke support at all. */
export function rule(
  y: number,
  width: number,
  fill: string,
  thickness = 1,
  opacity?: number,
): string {
  return rect({
    x: 0,
    y,
    width,
    height: thickness,
    fill,
    ...(opacity !== undefined ? { opacity } : {}),
  });
}

/**
 * Wraps card body content in the root `<svg>`.
 *
 * No XML prolog: the output is embedded and rasterised, never served as a standalone
 * document, and omitting it keeps the string one concatenation simpler.
 *
 * `role="img"` plus a `<title>` gives the card an accessible name wherever the SVG
 * itself is rendered (a future in-app preview, or a viewer that follows an `og:image`
 * to the vector). A rasterised PNG loses this, which is exactly why 085-b still owes
 * the `og:image:alt` that carries the same sentence to a screen reader.
 */
export function svgDocument(title: string, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" ` +
    `viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img">` +
    `<title>${escapeXml(title)}</title>` +
    body +
    `</svg>`
  );
}
