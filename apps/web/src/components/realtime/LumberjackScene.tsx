import { useEffect, useRef } from "react";
import { LUMBERJACK, timeLeftFraction, type LumberjackState } from "@mpg/engine";
import type { RealtimeSceneProps } from "../../screens/RealtimePlayScreen";
import styles from "./FloppyBirdsScene.module.css";

/**
 * The Lumberjack renderer (MPG-041). Draws the trunk, the branches, the standing
 * figure and the timer PURELY from `LumberjackState` — no state of its own, no
 * clock, no randomness: a snapshot in, a frame out, like every other arcade scene
 * (ADR 0002).
 *
 * `aria-hidden` — the accessible state (labelled play region, score, live region)
 * lives on `RealtimePlayScreen`; this canvas is a pure visual projection of it.
 *
 * **Not colour-only** (UX DoD): the timer is a bar whose LENGTH carries the
 * reading, branches are drawn as shapes protruding from the trunk on a specific
 * side, and the lumberjack is a distinct silhouette. Colour only reinforces.
 */

const RES = 480;
const TRUNK_W = RES * 0.22;
const TRUNK_X = (RES - TRUNK_W) / 2;
// Branches stop short of where the lumberjack stands, and the figure is drawn
// OUTBOARD of their reach. That gap is not decoration: "is there a branch at my
// height, on my side?" is the only question this game asks, and a figure drawn
// on top of the branch makes the one read the player needs ambiguous.
const BRANCH_W = RES * 0.17;
const BRANCH_H = RES * 0.055;
const STAND_GAP = RES * 0.055;
const TIMER_H = RES * 0.035;
const TIMER_PAD = RES * 0.04;

interface Palette {
  bg: string;
  trunk: string;
  trunkLine: string;
  branch: string;
  figure: string;
  timer: string;
  timerLow: string;
  timerTrack: string;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--color-bg", "#05070f"),
    trunk: v("--color-cabinet-raised", "#3a2a1c"),
    trunkLine: v("--color-cabinet-line", "#2a1e14"),
    branch: v("--color-success", "#3ddc97"),
    figure: v("--color-accent", "#7c9cff"),
    timer: v("--color-success", "#3ddc97"),
    timerLow: v("--color-danger", "#ff5c5c"),
    timerTrack: v("--color-bg-inset", "#0b1020"),
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

/**
 * The lumberjack: a simple standing silhouette with an axe, facing the trunk.
 *
 * `h` is passed in rather than fixed so the figure is exactly as tall as one log
 * — which is the truth of the game, since the log at their height is the one the
 * next chop removes. A figure spanning two log rows would misreport that.
 */
function drawFigure(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  h: number,
  facing: 1 | -1,
  palette: Palette,
): void {
  const w = h * 0.42;
  ctx.fillStyle = palette.figure;
  // Body.
  roundRect(ctx, x - w / 2, baseY - h, w, h * 0.72, w * 0.3);
  ctx.fill();
  // Head.
  ctx.beginPath();
  ctx.arc(x, baseY - h - h * 0.16, h * 0.17, 0, Math.PI * 2);
  ctx.fill();
  // Legs.
  roundRect(ctx, x - w / 2, baseY - h * 0.3, w * 0.35, h * 0.3, w * 0.15);
  ctx.fill();
  roundRect(ctx, x + w * 0.15, baseY - h * 0.3, w * 0.35, h * 0.3, w * 0.15);
  ctx.fill();
  // Axe, held out toward the trunk — which is also what shows which way they face.
  ctx.save();
  ctx.translate(x + facing * w * 0.55, baseY - h * 0.62);
  ctx.rotate(facing * 0.5);
  roundRect(ctx, 0, -h * 0.035, h * 0.5, h * 0.07, h * 0.03);
  ctx.fill();
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, state: LumberjackState, palette: Palette): void {
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, RES, RES);

  // The play field sits below the timer bar; the ground line is where the
  // lumberjack stands and where the bottom log rests.
  const fieldTop = TIMER_PAD * 2 + TIMER_H;
  const groundY = RES * 0.88;
  const logH = (groundY - fieldTop) / LUMBERJACK.trunkHeight;

  // Trunk, bottom log first (trunk[0] is at the lumberjack's own height).
  for (let i = 0; i < state.trunk.length; i += 1) {
    const y = groundY - (i + 1) * logH;
    ctx.fillStyle = palette.trunk;
    roundRect(ctx, TRUNK_X, y + 1, TRUNK_W, logH - 2, RES * 0.012);
    ctx.fill();
    // A hairline between logs, so the trunk reads as a stack of cuts.
    ctx.strokeStyle = palette.trunkLine;
    ctx.lineWidth = 1;
    ctx.stroke();

    const branch = state.trunk[i];
    if (branch === "none" || branch === undefined) continue;
    const by = y + logH / 2 - BRANCH_H / 2;
    const bx = branch === "left" ? TRUNK_X - BRANCH_W : TRUNK_X + TRUNK_W;
    ctx.fillStyle = palette.branch;
    roundRect(ctx, bx, by, BRANCH_W, BRANCH_H, BRANCH_H / 2);
    ctx.fill();
  }

  // Ground line.
  ctx.strokeStyle = palette.trunkLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(RES, groundY);
  ctx.stroke();

  // The lumberjack, standing at the side they last chopped from, facing in, and
  // clear of the branches' reach so the bottom row stays readable.
  const standX =
    state.side === "left"
      ? TRUNK_X - BRANCH_W - STAND_GAP
      : TRUNK_X + TRUNK_W + BRANCH_W + STAND_GAP;
  drawFigure(ctx, standX, groundY, logH * 0.92, state.side === "left" ? 1 : -1, palette);

  // Timer bar: LENGTH is the reading, colour is a second channel that turns
  // urgent near empty. A bar that only changed colour would fail the
  // not-colour-only rule outright.
  const fraction = timeLeftFraction(state);
  ctx.fillStyle = palette.timerTrack;
  roundRect(ctx, TIMER_PAD, TIMER_PAD, RES - TIMER_PAD * 2, TIMER_H, TIMER_H / 2);
  ctx.fill();
  ctx.fillStyle = fraction < 0.25 ? palette.timerLow : palette.timer;
  roundRect(
    ctx,
    TIMER_PAD,
    TIMER_PAD,
    Math.max(TIMER_H, (RES - TIMER_PAD * 2) * fraction),
    TIMER_H,
    TIMER_H / 2,
  );
  ctx.fill();
}

export function LumberjackScene({ state }: RealtimeSceneProps<LumberjackState>): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    // No 2D context (e.g. jsdom) → no-op; the screen's accessible state stands
    // on its own, so the game still runs, it just isn't painted.
    if (!canvas || !ctx) return;
    draw(ctx, state, readPalette(canvas));
  }, [state]);

  return (
    <canvas ref={canvasRef} width={RES} height={RES} className={styles.canvas} aria-hidden="true" />
  );
}
