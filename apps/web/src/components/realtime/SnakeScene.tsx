import { useEffect, useRef } from "react";
import { SNAKE, type SnakeDir, type SnakeState } from "@mpg/engine";
import type { RealtimeSceneProps } from "../../screens/RealtimePlayScreen";
import styles from "./FloppyBirdsScene.module.css";

/**
 * The Snake renderer (MPG-140, reskinned MPG-143). Draws the grid PURELY from
 * `SnakeState` — no state of its own, no clock, no randomness: a snapshot in, a
 * frame out, exactly like the other arcade scenes. Canvas 2D for consistency with
 * the family (ADR 0002); the engine module carries no renderer, so this stays
 * swappable.
 *
 * The body is drawn as one smooth, tapering tube rather than a row of discrete
 * squares: the cell centres are threaded onto a Catmull-Rom spline, so a turn is
 * a real curve through the corner instead of a right angle, and the radius eases
 * from a fat head to a fine tail. A darker outline pass under the fill keeps a
 * coiled body reading as separate loops where it doubles back.
 *
 * `aria-hidden` — the accessible state (labelled play region, score text, live
 * region) lives on `RealtimePlayScreen`, and the canvas is a pure visual
 * projection of it.
 *
 * **Not colour-only** (UX DoD): the head carries a facing pair of eyes and the
 * food is a circle with a highlight, so head, body, and food are distinguishable
 * by shape alone. Colour is a second channel, never the only one.
 */

// Internal drawing resolution; the board is square and CSS scales the canvas to
// the responsive surface.
const RES = 480;
/** Interpolated points drawn per gap between two adjacent cell centres — enough
 * that the tapering circles overlap into a seamless tube. */
const SAMPLES_PER_SEGMENT = 6;

interface Palette {
  boardBg: string;
  cellBg: string;
  body: string;
  head: string;
  outline: string;
  eye: string;
  food: string;
  foodGlow: string;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    boardBg: v("--color-bg", "#05070f"),
    cellBg: v("--color-bg-inset", "#0b1020"),
    body: v("--color-accent", "#7c9cff"),
    head: v("--color-accent-hover", "#9db4ff"),
    // The body sits on the board over its own outline; the board colour is the
    // natural separator between coils, so a doubled-back loop still reads.
    outline: v("--color-bg", "#05070f"),
    eye: v("--color-bg", "#05070f"),
    food: v("--color-success", "#3ddc97"),
    foodGlow: v("--color-success-text", "#8affca"),
  };
}

interface Pt {
  x: number;
  y: number;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The centre point of a cell index, in canvas px. */
function cellCentre(index: number, size: number, cell: number): Pt {
  return { x: (index % size) * cell + cell / 2, y: Math.floor(index / size) * cell + cell / 2 };
}

/** One Catmull-Rom sample between `p1` and `p2` (with neighbours `p0`,`p3`) at `t`. */
function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/**
 * A dense, smoothed centreline through the cell centres (head → tail), each point
 * tagged with `t` in [0,1] from head (0) to tail (1) so the caller can taper the
 * radius along the body. One point for a length-1 snake; otherwise Catmull-Rom
 * sampled so corners become curves.
 */
function smoothCentreline(points: readonly Pt[]): { p: Pt; t: number }[] {
  const n = points.length;
  if (n === 0) return [];
  const first = points[0];
  if (first === undefined) return [];
  if (n === 1) return [{ p: first, t: 0 }];

  const out: { p: Pt; t: number }[] = [];
  const total = n - 1; // number of gaps
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) continue;
    // Include the segment's start; the final point is appended once at the end so
    // adjacent segments don't double a sample on the shared cell centre.
    for (let s = 0; s < SAMPLES_PER_SEGMENT; s += 1) {
      const local = s / SAMPLES_PER_SEGMENT;
      out.push({ p: catmullRom(p0, p1, p2, p3, local), t: (i + local) / total });
    }
  }
  const last = points[n - 1];
  if (last !== undefined) out.push({ p: last, t: 1 });
  return out;
}

/** The two eye offsets (as fractions of a cell) for a head facing `dir`. */
function eyeOffsets(dir: SnakeDir): readonly [number, number][] {
  switch (dir) {
    case "up":
      return [
        [-0.18, -0.08],
        [0.18, -0.08],
      ];
    case "down":
      return [
        [-0.18, 0.08],
        [0.18, 0.08],
      ];
    case "left":
      return [
        [-0.08, -0.18],
        [-0.08, 0.18],
      ];
    case "right":
      return [
        [0.08, -0.18],
        [0.08, 0.18],
      ];
  }
}

function drawSnake(ctx: CanvasRenderingContext2D, state: SnakeState, palette: Palette): void {
  const size = SNAKE.size;
  const cell = RES / size;

  const centres = state.snake.map((i) => cellCentre(i, size, cell));
  const line = smoothCentreline(centres);
  if (line.length === 0) return;

  // Radius eases fat→fine along the body. A short snake shouldn't look like a
  // stub, so the head radius has a floor.
  const headR = cell * 0.42;
  const tailR = cell * 0.2;
  const radiusAt = (t: number): number => headR + (tailR - headR) * t;

  // Two passes of circles down the smoothed centreline: a darker, slightly wider
  // outline first, then the body over it. Opaque fills (no per-segment alpha)
  // mean overlapping circles leave no seams — the tube reads as one surface.
  const outlineGrow = Math.max(1.5, cell * 0.08);
  ctx.fillStyle = palette.outline;
  for (const { p, t } of line) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radiusAt(t) + outlineGrow, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = palette.body;
  for (const { p, t } of line) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radiusAt(t), 0, Math.PI * 2);
    ctx.fill();
  }

  // A soft sheen running the length of the back — a thin, translucent lighter
  // line down the centre, so the tube looks rounded rather than flat.
  ctx.strokeStyle = palette.head;
  ctx.globalAlpha = 0.28;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, cell * 0.12);
  ctx.beginPath();
  line.forEach(({ p }, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.globalAlpha = 1;

  // The head: a rounded cap in the brighter head colour, with eyes offset toward
  // the direction of travel so the snake plainly faces where it's going.
  const head = centres[0];
  if (head === undefined) return;
  ctx.fillStyle = palette.head;
  ctx.beginPath();
  ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
  ctx.fill();

  const eyeR = cell * 0.09;
  const pupilR = cell * 0.045;
  for (const [ox, oy] of eyeOffsets(state.dir)) {
    const ex = head.x + ox * cell;
    const ey = head.y + oy * cell;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.eye;
    ctx.beginPath();
    ctx.arc(ex, ey, pupilR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function draw(ctx: CanvasRenderingContext2D, state: SnakeState, palette: Palette): void {
  const size = SNAKE.size;
  const cell = RES / size;
  const gap = RES * 0.004; // hairline between the empty cells so the lattice reads

  ctx.fillStyle = palette.boardBg;
  ctx.fillRect(0, 0, RES, RES);

  // The empty grid, drawn first — a faint lattice gives the player something to
  // aim a turn at, which is most of what makes a fast snake steerable.
  ctx.fillStyle = palette.cellBg;
  for (let i = 0; i < size * size; i += 1) {
    const x = (i % size) * cell;
    const y = Math.floor(i / size) * cell;
    roundRect(ctx, x + gap, y + gap, cell - gap * 2, cell - gap * 2, cell * 0.14);
    ctx.fill();
  }

  // Food: a circle with a soft glow and a highlight, so it never reads as another
  // body segment and clearly says "eat me".
  if (state.food !== null) {
    const f = cellCentre(state.food, size, cell);
    ctx.save();
    ctx.shadowColor = palette.foodGlow;
    ctx.shadowBlur = cell * 0.4;
    ctx.fillStyle = palette.food;
    ctx.beginPath();
    ctx.arc(f.x, f.y, cell * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.beginPath();
    ctx.arc(f.x - cell * 0.09, f.y - cell * 0.09, cell * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }

  drawSnake(ctx, state, palette);
}

export function SnakeScene({ state }: RealtimeSceneProps<SnakeState>): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    // No 2D context (e.g. jsdom) → no-op. The screen's accessible state stands on
    // its own, so the game still runs; it just isn't painted.
    if (!canvas || !ctx) return;
    draw(ctx, state, readPalette(canvas));
  }, [state]);

  return (
    <canvas ref={canvasRef} width={RES} height={RES} className={styles.canvas} aria-hidden="true" />
  );
}
