import { useEffect, useRef } from "react";
import { FLOPPY_WORLD, type FloppyState } from "@mpg/engine";
import type { RealtimeSceneProps } from "../../screens/RealtimePlayScreen";
import styles from "./FloppyBirdsScene.module.css";

/**
 * MPG-040e — the Floppy Birds renderer. Draws bird + pipes + score PURELY from
 * `FloppyState` (no state of its own, no clock, no randomness): a snapshot in →
 * a frame out, exactly mirroring how the turn-based board renderers derive
 * everything from `GameModule` state. All motion comes from the state changing
 * upstream (the fixed-step loop in `useRealtimeLoop`), so the picture is a pure
 * function of `(state, reducedMotion)`.
 *
 * Canvas 2D for the POC (ADR 0002 — the three.js/WebGL decision is parked, see
 * [[animation-tech-decision]]); the module carries no renderer, so swapping this
 * out later touches nothing in the engine. `aria-hidden`: the accessible state
 * lives on the screen (the labelled play region, the score text, the live
 * region) — the canvas is a purely visual projection.
 */

// Internal drawing resolution; the world is a 100×100 square, so the scale is
// RES / FLOPPY_WORLD.width. CSS stretches the canvas to the (responsive) surface.
const RES = 480;

interface Palette {
  sky: string;
  skyDeep: string;
  pipe: string;
  pipeEdge: string;
  bird: string;
  ink: string;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return {
    sky: v("--color-bg-inset", "#0b1020"),
    skyDeep: v("--color-bg", "#05070f"),
    pipe: v("--color-success", "#3ddc84"),
    pipeEdge: v("--color-success-text", "#116b3a"),
    bird: v("--color-warning", "#ffd23f"),
    ink: v("--color-text", "#e8eaf0"),
  };
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: FloppyState,
  score: number,
  reducedMotion: boolean,
  palette: Palette,
): void {
  const k = RES / FLOPPY_WORLD.width;
  const px = (worldUnits: number): number => worldUnits * k;

  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, RES);
  sky.addColorStop(0, palette.skyDeep);
  sky.addColorStop(1, palette.sky);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, RES, RES);

  // Decorative parallax dots — purely cosmetic depth, DROPPED under reduced
  // motion (ADR §5: no non-essential motion). Offset derives from the tick
  // counter so it scrolls with the world, deterministically.
  if (!reducedMotion) {
    ctx.fillStyle = palette.ink;
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 24; i++) {
      const speed = 0.15 + (i % 3) * 0.1;
      const x = (((i * 53) % 100) - state.t * speed) % 100;
      const wx = x < 0 ? x + 100 : x;
      ctx.beginPath();
      ctx.arc(px(wx), px(8 + ((i * 37) % 70)), 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Pipes: a top and bottom column framing the passable gap.
  const w = px(FLOPPY_WORLD.pipeWidth);
  for (const p of state.pipes) {
    const x = px(p.x);
    const gapTop = px(p.gapY - FLOPPY_WORLD.pipeGap / 2);
    const gapBottom = px(p.gapY + FLOPPY_WORLD.pipeGap / 2);
    ctx.fillStyle = palette.pipe;
    ctx.fillRect(x, 0, w, gapTop);
    ctx.fillRect(x, gapBottom, w, RES - gapBottom);
    // Lip highlights so the gap edges read clearly (not motion; always drawn).
    ctx.fillStyle = palette.pipeEdge;
    ctx.fillRect(x, gapTop - px(2), w, px(2));
    ctx.fillRect(x, gapBottom, w, px(2));
  }

  // Bird. A slight tilt tracks vertical velocity — decorative, so it's held
  // level under reduced motion.
  const bx = px(FLOPPY_WORLD.birdX);
  const by = px(state.birdY);
  const r = px(FLOPPY_WORLD.birdRadius);
  ctx.save();
  ctx.translate(bx, by);
  if (!reducedMotion) {
    const tilt = Math.max(-0.5, Math.min(0.9, state.birdV * 0.18));
    ctx.rotate(tilt);
  }
  ctx.fillStyle = palette.bird;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Eye + beak — static shape cues, always drawn (they read as "a bird", not motion).
  ctx.fillStyle = palette.ink;
  ctx.beginPath();
  ctx.arc(r * 0.35, -r * 0.3, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.pipeEdge;
  ctx.beginPath();
  ctx.moveTo(r * 0.9, -r * 0.1);
  ctx.lineTo(r * 1.6, 0);
  ctx.lineTo(r * 0.9, r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Score, drawn large + centered at the top (also shown as accessible text on
  // the screen; this is the in-world arcade readout, derived from state).
  ctx.fillStyle = palette.ink;
  ctx.font = `700 ${px(10)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(String(score), RES / 2, px(6));
}

export function FloppyBirdsScene({
  state,
  score,
  reducedMotion,
}: RealtimeSceneProps<FloppyState>): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    // No 2D context (e.g. jsdom) → no-op; the screen's accessible state stands
    // on its own, so the game still "runs", it just isn't painted.
    if (!canvas || !ctx) return;
    draw(ctx, state, score, reducedMotion, readPalette(canvas));
  }, [state, score, reducedMotion]);

  return <canvas ref={canvasRef} width={RES} height={RES} className={styles.canvas} aria-hidden="true" />;
}
