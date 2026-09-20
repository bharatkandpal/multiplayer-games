import { useEffect, useRef } from "react";
import {
  inputTimeFraction,
  litPad,
  PAD_COUNT,
  round,
  type MemorySequenceState,
  type PadIndex,
} from "@mpg/engine";
import type { RealtimeSceneProps } from "../../screens/RealtimePlayScreen";
import styles from "./FloppyBirdsScene.module.css";

/**
 * The Memory Sequence renderer (MPG-141). Draws the four pads, the lit one, and
 * the turn clock PURELY from `MemorySequenceState` — no state of its own, no
 * clock, no randomness. The engine owns the playback timing (see
 * `memory-sequence.ts`), so this is a projection of `litPad(state)` and nothing
 * more: there is no animation here to drift out of sync with the rules.
 *
 * `aria-hidden` — the accessible state (labelled play region, score, live region)
 * lives on `RealtimePlayScreen`; this canvas is a pure visual projection.
 *
 * **Not colour-only** (UX DoD): each pad carries its own GLYPH, and the lit pad is
 * drawn brighter *and* larger *and* ringed. A player who cannot separate the four
 * hues can still read the sequence off the shapes — which matters more here than
 * in any other game on the shelf, since reading the sequence IS the game.
 */

const RES = 480;
const PAD_GAP = RES * 0.035;
const FIELD_TOP = RES * 0.14;
const FIELD = RES - FIELD_TOP - RES * 0.04;
const PAD = (FIELD - PAD_GAP) / 2;
const FIELD_X = (RES - (PAD * 2 + PAD_GAP)) / 2;

/** One glyph per pad — the non-colour channel that makes the sequence readable. */
const GLYPHS = ["▲", "●", "■", "◆"] as const;

/**
 * A distinct hue per pad (MPG-141 follow-up). Simon's whole visual language is
 * "four differently-coloured pads", so each pad now owns a colour rather than
 * sharing one accent — `dim` is its resting fill, `lit` its flash, and `glyph`
 * the glyph colour ON the lit fill (chosen dark or light per hue for contrast).
 * Colour is still never the ONLY channel: the glyphs and the lit pad's grow +
 * ring carry the same information for a colour-blind player (see `draw`).
 */
const PAD_COLORS = [
  { dim: "#14432c", lit: "#2ee06a", glyph: "#04210f" }, // ▲ green (top-left)
  { dim: "#4a1530", lit: "#ff4d7d", glyph: "#2a0512" }, // ● rose  (top-right)
  { dim: "#13284d", lit: "#3d8bff", glyph: "#041025" }, // ■ blue  (bottom-left)
  { dim: "#4a3a10", lit: "#ffc21f", glyph: "#241a02" }, // ◆ amber (bottom-right)
] as const;

interface Palette {
  bg: string;
  glyph: string;
  ring: string;
  clock: string;
  clockLow: string;
  clockTrack: string;
  text: string;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--color-bg", "#05070f"),
    // Glyph colour on a DIM (resting) pad — muted so the coloured pad reads first.
    glyph: v("--color-text-muted", "#8b93a7"),
    // The bright ring drawn around a lit pad, on top of its own colour.
    ring: v("--color-on-accent", "#ffffff"),
    clock: v("--color-accent", "#7c9cff"),
    clockLow: v("--color-danger", "#ff5c5c"),
    clockTrack: v("--color-bg-inset", "#0b1020"),
    text: v("--color-text", "#e7ebf5"),
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

function draw(ctx: CanvasRenderingContext2D, state: MemorySequenceState, palette: Palette): void {
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, RES, RES);

  // Whose turn it is, and how long is left of it. "Watch" vs "Your turn" is the
  // single most important thing on screen — press during playback and nothing
  // happens, so a player who can't tell the phases apart thinks the game is broken.
  const answering = state.phase === "input";
  ctx.fillStyle = palette.text;
  ctx.font = `700 ${RES * 0.055}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(answering ? "Your turn" : "Watch", RES * 0.05, RES * 0.055);

  ctx.font = `500 ${RES * 0.04}px system-ui, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(`Round ${round(state)}`, RES - RES * 0.05, RES * 0.055);

  // The turn clock, drawn only while it's actually running — a countdown that is
  // always on screen but only sometimes meaningful is just noise.
  if (answering) {
    const fraction = inputTimeFraction(state);
    const barY = RES * 0.095;
    const barH = RES * 0.018;
    ctx.fillStyle = palette.clockTrack;
    roundRect(ctx, RES * 0.05, barY, RES * 0.9, barH, barH / 2);
    ctx.fill();
    ctx.fillStyle = fraction < 0.25 ? palette.clockLow : palette.clock;
    roundRect(ctx, RES * 0.05, barY, Math.max(barH, RES * 0.9 * fraction), barH, barH / 2);
    ctx.fill();
  }

  const lit = litPad(state);
  for (let i = 0; i < PAD_COUNT; i += 1) {
    const isLit = lit === (i as PadIndex);
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = FIELD_X + col * (PAD + PAD_GAP);
    const y = FIELD_TOP + row * (PAD + PAD_GAP);
    const pad = PAD_COLORS[i] ?? PAD_COLORS[0];
    // A lit pad also GROWS — a size change reads at a glance and survives any
    // colour-vision difference.
    const grow = isLit ? PAD * 0.035 : 0;

    ctx.fillStyle = isLit ? pad.lit : pad.dim;
    roundRect(ctx, x - grow, y - grow, PAD + grow * 2, PAD + grow * 2, PAD * 0.16);
    ctx.fill();
    if (isLit) {
      ctx.strokeStyle = palette.ring;
      ctx.lineWidth = RES * 0.008;
      ctx.stroke();
    }

    // On the bright lit fill, the glyph takes the pad's own dark ink; on the
    // resting fill it stays muted so the colour is what reads first.
    ctx.fillStyle = isLit ? pad.glyph : palette.glyph;
    ctx.font = `700 ${PAD * (isLit ? 0.46 : 0.4)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(GLYPHS[i] ?? "", x + PAD / 2, y + PAD / 2);
  }
}

export function MemorySequenceScene({
  state,
}: RealtimeSceneProps<MemorySequenceState>): React.JSX.Element {
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
