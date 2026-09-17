import { useEffect, useRef } from "react";
import { SNAKE, type SnakeDir, type SnakeState } from "@mpg/engine";
import type { RealtimeSceneProps } from "../../screens/RealtimePlayScreen";
import styles from "./FloppyBirdsScene.module.css";

/**
 * The Snake renderer (MPG-140). Draws the grid PURELY from `SnakeState` — no
 * state of its own, no clock, no randomness: a snapshot in, a frame out, exactly
 * like the other arcade scenes. Canvas 2D for consistency with the family
 * (ADR 0002); the engine module carries no renderer, so this stays swappable.
 *
 * `aria-hidden` — the accessible state (labelled play region, score text, live
 * region) lives on `RealtimePlayScreen`, and the canvas is a pure visual
 * projection of it.
 *
 * **Not colour-only** (UX DoD): the head is drawn with a facing pair of eyes and
 * the food as a circle against the snake's rounded squares, so the three things
 * on the board — head, body, food — are distinguishable by shape alone. Colour
 * is a second channel, never the only one.
 */

// Internal drawing resolution; the board is square and CSS scales the canvas to
// the responsive surface.
const RES = 480;
const GAP = RES * 0.004; // hairline between cells, so a coiled body still reads as segments

interface Palette {
  boardBg: string;
  cellBg: string;
  body: string;
  head: string;
  eye: string;
  food: string;
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
    eye: v("--color-bg", "#05070f"),
    food: v("--color-success", "#3ddc97"),
  };
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

/** The two eye offsets (as fractions of a cell) for a head facing `dir`. */
function eyeOffsets(dir: SnakeDir): readonly [number, number][] {
  switch (dir) {
    case "up":
      return [
        [0.3, 0.28],
        [0.7, 0.28],
      ];
    case "down":
      return [
        [0.3, 0.72],
        [0.7, 0.72],
      ];
    case "left":
      return [
        [0.28, 0.3],
        [0.28, 0.7],
      ];
    case "right":
      return [
        [0.72, 0.3],
        [0.72, 0.7],
      ];
  }
}

function draw(ctx: CanvasRenderingContext2D, state: SnakeState, palette: Palette): void {
  const size = SNAKE.size;
  const cell = RES / size;

  ctx.fillStyle = palette.boardBg;
  ctx.fillRect(0, 0, RES, RES);

  // The empty grid, drawn first — a faint lattice gives the player something to
  // aim a turn at, which is most of what makes a fast snake steerable.
  ctx.fillStyle = palette.cellBg;
  for (let i = 0; i < size * size; i += 1) {
    const x = (i % size) * cell;
    const y = Math.floor(i / size) * cell;
    roundRect(ctx, x + GAP, y + GAP, cell - GAP * 2, cell - GAP * 2, cell * 0.14);
    ctx.fill();
  }

  // Food: a circle, so it never reads as another body segment.
  if (state.food !== null) {
    const fx = (state.food % size) * cell + cell / 2;
    const fy = Math.floor(state.food / size) * cell + cell / 2;
    ctx.fillStyle = palette.food;
    ctx.beginPath();
    ctx.arc(fx, fy, cell * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body, tail-first so the head paints on top of a cell it shares with nothing.
  // Alpha ramps from the tail to the head, which shows travel direction at a
  // glance without animating anything.
  const len = state.snake.length;
  for (let i = len - 1; i >= 1; i -= 1) {
    const segment = state.snake[i];
    if (segment === undefined) continue;
    const x = (segment % size) * cell;
    const y = Math.floor(segment / size) * cell;
    ctx.globalAlpha = 0.55 + 0.45 * (1 - i / Math.max(1, len));
    ctx.fillStyle = palette.body;
    roundRect(ctx, x + GAP, y + GAP, cell - GAP * 2, cell - GAP * 2, cell * 0.22);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const head = state.snake[0];
  if (head === undefined) return;
  const hx = (head % size) * cell;
  const hy = Math.floor(head / size) * cell;
  ctx.fillStyle = palette.head;
  roundRect(ctx, hx + GAP, hy + GAP, cell - GAP * 2, cell - GAP * 2, cell * 0.3);
  ctx.fill();

  ctx.fillStyle = palette.eye;
  for (const [ox, oy] of eyeOffsets(state.dir)) {
    ctx.beginPath();
    ctx.arc(hx + cell * ox, hy + cell * oy, cell * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
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
