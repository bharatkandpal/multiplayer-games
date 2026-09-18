import { useEffect, useRef } from "react";
import { AIM, AIM_CELLS, missesLeft, type AimTrainerState } from "@mpg/engine";
import type { RealtimeSceneProps } from "../../screens/RealtimePlayScreen";
import styles from "./FloppyBirdsScene.module.css";

/**
 * The Aim Trainer renderer (MPG-142). Draws the grid, the live targets and the
 * remaining misses PURELY from `AimTrainerState` — no state of its own, no clock,
 * no randomness: a snapshot in, a frame out, like every arcade scene (ADR 0002).
 *
 * `aria-hidden` — the accessible state (labelled play region, score, live region)
 * lives on `RealtimePlayScreen`; this canvas is a pure visual projection. The
 * keyboard cursor is NOT drawn here: it belongs to the `tap-target` input source,
 * which renders it as a DOM overlay over this surface, so the cursor survives any
 * change of renderer.
 *
 * **Not colour-only** (UX DoD): a target is a filled disc with a bullseye ring —
 * present or absent, a shape difference, not a tint. Its remaining life is drawn
 * as a shrinking arc (an angle, not a hue), and the misses left are drawn as a
 * row of pips you can count.
 */

const RES = 480;
const PAD = RES * 0.02;

// The grid fills the WHOLE surface, and that is a correctness requirement rather
// than a layout preference: the `tap-target` source reports a tap as a fraction
// of the surface, and `cellAt` maps that fraction across the whole board. Reserve
// a band at the top for a HUD and every tap lands one row off from the cell it
// was aimed at. So the misses indicator is drawn as an overlay ON the grid
// instead, where it costs no space and shifts no cell.
const PIP_R = RES * 0.014;
/** How far outside the target disc the countdown arc is drawn. */
const FUSE_SCALE = 1.32;

interface Palette {
  bg: string;
  cell: string;
  target: string;
  targetRing: string;
  fuse: string;
  fuseLow: string;
  pip: string;
  pipSpent: string;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--color-bg", "#05070f"),
    cell: v("--color-bg-inset", "#0b1020"),
    target: v("--color-accent", "#7c9cff"),
    targetRing: v("--color-on-accent", "#ffffff"),
    fuse: v("--color-success", "#3ddc97"),
    fuseLow: v("--color-danger", "#ff5c5c"),
    pip: v("--color-danger", "#ff5c5c"),
    pipSpent: v("--color-border", "#2a3046"),
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

function draw(ctx: CanvasRenderingContext2D, state: AimTrainerState, palette: Palette): void {
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, RES, RES);

  // The board geometry must match the engine's `cellAt` mapping exactly — the
  // whole grid, edge to edge — or a tap the player aimed at a target lands on
  // the cell next door.
  const cellW = RES / AIM.cols;
  const cellH = RES / AIM.rows;

  for (let i = 0; i < AIM_CELLS; i += 1) {
    const x = (i % AIM.cols) * cellW;
    const y = Math.floor(i / AIM.cols) * cellH;
    ctx.fillStyle = palette.cell;
    roundRect(ctx, x + PAD, y + PAD, cellW - PAD * 2, cellH - PAD * 2, RES * 0.02);
    ctx.fill();
  }

  for (const target of state.targets) {
    const cx = (target.cell % AIM.cols) * cellW + cellW / 2;
    const cy = Math.floor(target.cell / AIM.cols) * cellH + cellH / 2;
    // Sized so the OUTERMOST ring — the fuse arc, at `FUSE_SCALE` — still sits
    // inside its own cell. An edge-column target whose arc is clipped by the
    // surface reads as a different, smaller amount of time left than it has.
    const r = ((Math.min(cellW, cellH) / 2 - PAD) / FUSE_SCALE) * 0.82;

    ctx.fillStyle = palette.target;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Bullseye ring — the shape that says "target" without relying on the fill.
    ctx.strokeStyle = palette.targetRing;
    ctx.lineWidth = r * 0.18;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
    ctx.stroke();

    // The fuse: a shrinking arc around the target. An ANGLE, not a colour —
    // colour only reinforces it as time runs out.
    const life = target.lifetime > 0 ? target.ticksLeft / target.lifetime : 0;
    ctx.strokeStyle = life < 0.3 ? palette.fuseLow : palette.fuse;
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    ctx.arc(cx, cy, r * FUSE_SCALE, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * life);
    ctx.stroke();
  }

  // Misses left, as countable pips, drawn LAST so they sit over the grid rather
  // than pushing it down. A number would need text; pips read at a glance.
  const pipsW = PIP_R * 3 * AIM.maxMisses;
  ctx.fillStyle = palette.bg;
  ctx.globalAlpha = 0.72;
  roundRect(ctx, PAD * 1.5, PAD * 1.5, pipsW + PIP_R, PIP_R * 3.4, PIP_R * 1.7);
  ctx.fill();
  ctx.globalAlpha = 1;
  const left = missesLeft(state);
  for (let i = 0; i < AIM.maxMisses; i += 1) {
    ctx.fillStyle = i < left ? palette.pip : palette.pipSpent;
    ctx.beginPath();
    ctx.arc(PAD * 1.5 + PIP_R * 2 + i * PIP_R * 3, PAD * 1.5 + PIP_R * 1.7, PIP_R, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function AimTrainerScene({ state }: RealtimeSceneProps<AimTrainerState>): React.JSX.Element {
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
