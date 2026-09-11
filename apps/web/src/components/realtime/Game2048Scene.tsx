import { useEffect, useRef } from "react";
import { GAME_2048, type Game2048State } from "@mpg/engine";
import type { RealtimeSceneProps } from "../../screens/RealtimePlayScreen";
import styles from "./FloppyBirdsScene.module.css";

/**
 * The 2048 renderer (MPG-074). Draws the 4×4 grid PURELY from `Game2048State`
 * (no state of its own, no clock, no randomness): a snapshot in → a frame out,
 * exactly like the other realtime scenes. Canvas 2D for consistency with the
 * arcade family (ADR 0002); the engine module carries no renderer, so this stays
 * swappable. `aria-hidden` — the accessible state (labelled play region, score
 * text, live region) lives on `RealtimePlayScreen`; the canvas is a pure visual
 * projection.
 */

// Internal drawing resolution; the board is a square, CSS scales the canvas to
// the responsive surface.
const RES = 480;
const SIZE = GAME_2048.size;
const PAD = RES * 0.03; // gutter around and between tiles
const CELL = (RES - PAD * (SIZE + 1)) / SIZE;

interface Palette {
  boardBg: string;
  cellBg: string;
  tile: string;
  tileText: string;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    boardBg: v("--color-bg", "#05070f"),
    cellBg: v("--color-bg-inset", "#0b1020"),
    tile: v("--color-accent", "#7c9cff"),
    tileText: v("--color-accent-text", "#ffffff"),
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

function draw(ctx: CanvasRenderingContext2D, state: Game2048State, palette: Palette): void {
  ctx.fillStyle = palette.boardBg;
  ctx.fillRect(0, 0, RES, RES);

  for (let i = 0; i < state.board.length; i += 1) {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    const x = PAD + c * (CELL + PAD);
    const y = PAD + r * (CELL + PAD);
    const value = state.board[i] ?? 0;

    // Empty cell backing.
    ctx.fillStyle = palette.cellBg;
    roundRect(ctx, x, y, CELL, CELL, CELL * 0.12);
    ctx.fill();

    if (value === 0) continue;

    // Tile fill: brighter as the exponent climbs, so a bigger tile reads as
    // "more". Alpha ramps 0.35→1 over exponents 1..11 (2..2048).
    const exp = Math.log2(value);
    const alpha = Math.min(1, 0.3 + exp * 0.07);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = palette.tile;
    roundRect(ctx, x, y, CELL, CELL, CELL * 0.12);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Number. Shrink the font for longer numbers so 1024/2048 still fit.
    const label = String(value);
    const fontSize =
      label.length >= 4 ? CELL * 0.34 : label.length === 3 ? CELL * 0.42 : CELL * 0.5;
    ctx.fillStyle = palette.tileText;
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + CELL / 2, y + CELL / 2 + fontSize * 0.04);
  }
}

export function Game2048Scene({ state }: RealtimeSceneProps<Game2048State>): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    // No 2D context (e.g. jsdom) → no-op; the screen's accessible state stands
    // on its own, so the game still "runs", it just isn't painted.
    if (!canvas || !ctx) return;
    draw(ctx, state, readPalette(canvas));
  }, [state]);

  return (
    <canvas ref={canvasRef} width={RES} height={RES} className={styles.canvas} aria-hidden="true" />
  );
}
