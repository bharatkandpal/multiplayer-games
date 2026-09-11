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
    ball: v("--color-text", "#e8eaf0"),
    ink: v("--color-text", "#e8eaf0"),
  };
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: BreakoutState,
  reducedMotion: boolean,
  palette: Palette,
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

  // Ball. A short motion trail adds speed feel — decorative, dropped under
  // reduced motion.
  const bx = px(state.ballX);
  const by = px(state.ballY);
  const br = px(BREAKOUT_WORLD.ballRadius);
  if (!reducedMotion) {
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = palette.ball;
    ctx.beginPath();
    ctx.arc(bx - px(state.ballVX), by - px(state.ballVY), br, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = palette.ball;
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fill();

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

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    // No 2D context (e.g. jsdom) → no-op; the screen's accessible state stands
    // on its own, so the game still "runs", it just isn't painted.
    if (!canvas || !ctx) return;
    draw(ctx, state, reducedMotion, readPalette(canvas));
  }, [state, reducedMotion]);

  return (
    <canvas ref={canvasRef} width={RES} height={RES} className={styles.canvas} aria-hidden="true" />
  );
}
