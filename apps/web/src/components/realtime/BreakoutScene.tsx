import { useEffect, useRef } from "react";
import { BREAKOUT_WORLD, brickRect, type BreakoutState } from "@mpg/engine";
import type { RealtimeSceneProps } from "../../screens/RealtimePlayScreen";
import styles from "./FloppyBirdsScene.module.css";

/**
 * The Breakout renderer (MPG-075). Draws paddle + ball + brick wall + lives
 * PURELY from `BreakoutState` (no state of its own, no clock, no randomness): a
 * snapshot in → a frame out, like the other realtime scenes. Canvas 2D (ADR
 * 0002); the engine module carries no renderer. `aria-hidden` — the accessible
 * state (labelled play region, score text, live region) lives on
 * `RealtimePlayScreen`; the canvas is a pure visual projection.
 */

// Internal drawing resolution; the world is 100×100, so scale = RES / width.
const RES = 480;

// Brick-break burst (MPG-075 polish). Decorative only — spawned by the renderer
// when a brick disappears between two states, never by the pure engine. Timed by
// wall clock (performance.now) so it animates smoothly across the 60Hz ticks that
// redraw the scene, and skipped entirely under reduced motion.
const BURST_MS = 280;
const SHARD_COUNT = 7;
const SHARD_REACH = 8; // world units a shard travels over its life
const SHARD_SIZE = 1.9; // world-unit side of a shard at birth

interface Burst {
  readonly cx: number; // brick centre, world units
  readonly cy: number;
  readonly color: string;
  readonly spin: number; // per-burst angle offset so bursts don't look identical
  readonly born: number; // performance.now() at spawn
}

interface Palette {
  bg: string;
  bgDeep: string;
  brick: string;
  brickAlt: string;
  paddle: string;
  ball: string;
  ink: string;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--color-bg-inset", "#0b1020"),
    bgDeep: v("--color-bg", "#05070f"),
    brick: v("--color-accent", "#7c9cff"),
    brickAlt: v("--color-success", "#3ddc84"),
    paddle: v("--color-warning", "#ffd23f"),
    ball: v("--color-danger", "#ef4444"),
    ink: v("--color-text", "#e8eaf0"),
  };
}

/** Draws every live shard burst, fading and flinging outward over its life. */
function drawBursts(
  ctx: CanvasRenderingContext2D,
  bursts: readonly Burst[],
  now: number,
  px: (u: number) => number,
): void {
  for (const burst of bursts) {
    const t = (now - burst.born) / BURST_MS; // 0 → 1 over the burst's life
    if (t < 0 || t >= 1) continue;
    const dist = SHARD_REACH * t;
    const size = px(SHARD_SIZE * (1 - t * 0.7));
    ctx.save();
    ctx.globalAlpha = 1 - t; // fade to nothing
    ctx.fillStyle = burst.color;
    for (let s = 0; s < SHARD_COUNT; s += 1) {
      const angle = burst.spin + (s / SHARD_COUNT) * Math.PI * 2;
      const x = px(burst.cx + Math.cos(angle) * dist);
      const y = px(burst.cy + Math.sin(angle) * dist);
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.restore();
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: BreakoutState,
  reducedMotion: boolean,
  palette: Palette,
  bursts: readonly Burst[],
  now: number,
): void {
  const k = RES / BREAKOUT_WORLD.width;
  const px = (u: number): number => u * k;

  // Background.
  const bg = ctx.createLinearGradient(0, 0, 0, RES);
  bg.addColorStop(0, palette.bgDeep);
  bg.addColorStop(1, palette.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, RES, RES);

  // Bricks. Two-tone by row so the wall reads as rows (not colour-only meaning —
  // it's decorative; the game state is "brick present or not").
  for (let i = 0; i < state.bricks.length; i += 1) {
    if (state.bricks[i] === 0) continue;
    const r = Math.floor(i / BREAKOUT_WORLD.cols);
    const { x0, y0, x1, y1 } = brickRect(i);
    ctx.fillStyle = r % 2 === 0 ? palette.brick : palette.brickAlt;
    ctx.fillRect(px(x0) + 1, px(y0) + 1, px(x1 - x0) - 2, px(y1 - y0) - 2);
  }

  // Paddle — drawn with a CONVEX top face so its shape reads the way it now
  // reflects (edges fan the ball out, centre sends it straight up). The bulge is
  // a quadratic curve peaking above the flat base by `bulge` world units.
  const pw = px(BREAKOUT_WORLD.paddleWidth);
  const ph = px(BREAKOUT_WORLD.paddleHeight);
  const cx = px(state.paddleX);
  const top = px(BREAKOUT_WORLD.paddleY);
  const left = cx - pw / 2;
  const right = cx + pw / 2;
  const base = top + ph;
  const bulge = px(2.6); // how far the crown rises above the flat top edge
  ctx.fillStyle = palette.paddle;
  ctx.beginPath();
  ctx.moveTo(left, base);
  ctx.lineTo(left, top);
  // Convex crown: a single quadratic from the left top corner to the right,
  // with the control point lifted above the corners so the middle bows upward.
  ctx.quadraticCurveTo(cx, top - bulge, right, top);
  ctx.lineTo(right, base);
  ctx.closePath();
  ctx.fill();

  // Ball. A tapering smoke tail trails behind it along the velocity vector —
  // each puff a step further back, smaller and fainter, so it dissipates like
  // smoke behind a moving asteroid. Decorative, dropped under reduced motion.
  const bx = px(state.ballX);
  const by = px(state.ballY);
  const br = px(BREAKOUT_WORLD.ballRadius);
  if (!reducedMotion) {
    const TRAIL_PUFFS = 5;
    const TRAIL_STEP = 0.6; // fraction of one frame's travel between puffs
    ctx.fillStyle = palette.ball;
    for (let i = 1; i <= TRAIL_PUFFS; i += 1) {
      const t = i / (TRAIL_PUFFS + 1); // 0..1 along the tail
      ctx.globalAlpha = 0.22 * (1 - t); // fade to nothing at the tail's end
      ctx.beginPath();
      ctx.arc(
        bx - px(state.ballVX) * TRAIL_STEP * i,
        by - px(state.ballVY) * TRAIL_STEP * i,
        br * (1 - 0.6 * t), // shrink as it dissipates
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = palette.ball;
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fill();

  // Brick-break shards, over the wall and ball. Empty (and skipped) under
  // reduced motion, since the bursts are pure decoration.
  if (!reducedMotion) drawBursts(ctx, bursts, now, px);

  // Lives as dots, top-left — a non-motion status cue (also announced as text).
  ctx.fillStyle = palette.ink;
  for (let i = 0; i < state.lives; i += 1) {
    ctx.beginPath();
    ctx.arc(px(4) + i * px(5), px(5), px(1.4), 0, Math.PI * 2);
    ctx.fill();
  }
}

export function BreakoutScene({
  state,
  reducedMotion,
}: RealtimeSceneProps<BreakoutState>): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The previous brick grid, so a break (1 → 0) can be spotted between frames —
  // the pure state carries no "just broke" flag. The live bursts persist across
  // ticks until they age out.
  const prevBricksRef = useRef<readonly number[] | null>(null);
  const burstsRef = useRef<Burst[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const palette = canvas ? readPalette(canvas) : null;
    const now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

    // Spawn a burst for each brick that vanished since the last frame. Skipped
    // under reduced motion, and never on the first frame (no previous grid to
    // diff, so the initial wall isn't mistaken for a break). Shards take the
    // brick's own row colour so a break reads as that brick shattering.
    const prev = prevBricksRef.current;
    if (!reducedMotion && prev !== null) {
      for (let i = 0; i < state.bricks.length; i += 1) {
        if (prev[i] === 1 && state.bricks[i] === 0) {
          const { x0, y0, x1, y1 } = brickRect(i);
          const row = Math.floor(i / BREAKOUT_WORLD.cols);
          const even = row % 2 === 0;
          burstsRef.current.push({
            cx: (x0 + x1) / 2,
            cy: (y0 + y1) / 2,
            color: palette
              ? even
                ? palette.brick
                : palette.brickAlt
              : even
                ? "#7c9cff"
                : "#3ddc84",
            spin: (i % SHARD_COUNT) * 0.5,
            born: now,
          });
        }
      }
    }
    prevBricksRef.current = state.bricks;

    // Drop finished bursts so the list can't grow without bound.
    burstsRef.current = burstsRef.current.filter((b) => now - b.born < BURST_MS);

    // No 2D context (e.g. jsdom) → no paint; the screen's accessible state stands
    // on its own, so the game still "runs", it just isn't painted.
    if (!canvas || !ctx || !palette) return;
    draw(ctx, state, reducedMotion, palette, burstsRef.current, now);
  }, [state, reducedMotion]);

  return (
    <canvas ref={canvasRef} width={RES} height={RES} className={styles.canvas} aria-hidden="true" />
  );
}
