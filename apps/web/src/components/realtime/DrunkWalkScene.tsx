import { useEffect, useRef } from "react";
import { DRUNK_WALK_WORLD, type DrunkWalkState, type SteppingLeg } from "@mpg/engine";
import type { RealtimeSceneProps } from "../../screens/RealtimePlayScreen";
import styles from "./DrunkWalkScene.module.css";

/** How close to the fail threshold the lean is, 0 (upright) → 1 (about to fall). */
function dangerFraction(angle: number): number {
  return Math.min(1, Math.abs(angle) / DRUNK_WALK_WORLD.failAngleDeg);
}

/**
 * MPG-076 — the Drunk Walk renderer. Draws the leaning figure + a foreshortened,
 * scrolling walkway PURELY from `DrunkWalkState` (no state of its own, no clock,
 * no randomness) — a snapshot in → a frame out, exactly mirroring
 * `FloppyBirdsScene`. All motion comes from the state changing upstream (the
 * fixed-step loop in `useRealtimeLoop`).
 *
 * Pseudo-3D via 2D Canvas only (no WebGL/three.js, ADR 0002 §5 / the parked
 * three.js decision): a foreshortened trapezoid ground plane converging toward
 * a horizon, gradient shading on the figure, and perspective-spaced "rungs"
 * scrolling toward the viewer to sell forward motion — all cheap 2D tricks.
 * The figure and rungs stay purely procedural (imperative Canvas draw calls);
 * the roadside trees and the asphalt ground texture are instead small
 * hand-authored inline SVG "sprites" (see `TREE_SVGS`/`GROUND_TEXTURE_SVG`
 * below), preloaded once into `Image` objects at module scope and painted via
 * `ctx.drawImage` — same placeholder-art complexity as the code they replace,
 * just asset-based instead of drawn shape-by-shape every frame.
 *
 * `aria-hidden`: same convention as Floppy Birds — the accessible state (score
 * text, live-region announcements, tap-zone hint) lives on the screen; this
 * canvas is a purely visual projection of the same state.
 */

const RES = 480;
// Horizon sits above center so the ground plane reads as a walkway receding
// away from the viewer, not filling the whole frame.
const HORIZON_Y = RES * 0.38;
const GROUND_TOP_HALF_WIDTH = RES * 0.06; // walkway width AT the horizon (vanishing)
const GROUND_BOTTOM_HALF_WIDTH = RES * 0.62; // walkway width at the viewer's feet

interface Palette {
  sky: string;
  skyDeep: string;
  /** Asphalt near the viewer (bottom of the ground trapezoid) — lighter than `asphaltFar`. */
  asphalt: string;
  /** Asphalt at the horizon (top of the ground trapezoid) — darker, blends with the sky. */
  asphaltFar: string;
  rung: string;
  left: string;
  right: string;
  figure: string;
  figureShade: string;
  danger: string;
  ink: string;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    sky: v("--color-bg-inset", "#0b1020"),
    skyDeep: v("--color-bg", "#05070f"),
    // Dedicated (currently un-themed) tokens rather than reusing --color-text-muted /
    // --color-bg-inset: those are shared, semantically-neutral tokens already assigned
    // elsewhere in this palette (bg-inset backs `sky`), so borrowing them here would
    // either couple the road color to the sky's or drift with unrelated text-contrast
    // tuning. Dark asphalt charcoal, lightening slightly toward the viewer.
    asphalt: v("--color-asphalt", "#3f4045"),
    asphaltFar: v("--color-asphalt-far", "#2a2b2f"),
    rung: v("--color-border-strong", "#4a5060"),
    left: v("--color-player-1", "#0072b2"),
    right: v("--color-player-2", "#b34700"),
    figure: v("--color-warning", "#ffd23f"),
    figureShade: v("--color-warning-text", "#9a5b00"),
    danger: v("--color-danger", "#c0152f"),
    ink: v("--color-text", "#e8eaf0"),
  };
}

/** Which side (screen-space, in the figure's LOCAL/unrotated frame) a leg/arm attaches on. */
function legAnchorX(leg: SteppingLeg, hipHalf: number): number {
  return leg === "left" ? -hipHalf : hipHalf;
}

/**
 * A weight-bearing leg: hip → knee → foot, foot flat on the ground (local y = 0, the
 * pivot/ground line the whole figure rotates around). Unlike the swinging leg's dramatic
 * mid-stride bend, this is a slight, natural standing-knee bend (a real planted leg is
 * never perfectly rigid) — just enough that it reads as a jointed limb consistent with
 * the swinging leg, while still looking grounded/weight-bearing. Gradient-shaded like the
 * torso so it reads as part of the same cylindrical figure.
 */
function drawPlantedLeg(
  ctx: CanvasRenderingContext2D,
  leg: SteppingLeg,
  hipY: number,
  hipHalf: number,
  legW: number,
  tone: string,
  shade: string,
): void {
  const x = legAnchorX(leg, hipHalf);
  // Knee sits roughly midway down the leg, nudged slightly forward — a subtle joint,
  // not a stride arc, so the standing leg still reads as grounded/rigid overall.
  const kneeY = hipY * 0.46;
  const kneeX = x + legW * 0.22;

  const grad = ctx.createLinearGradient(x - legW / 2, 0, x + legW / 2, 0);
  grad.addColorStop(0, shade);
  grad.addColorStop(0.5, tone);
  grad.addColorStop(1, shade);
  ctx.fillStyle = grad;

  // Thigh: hip → knee.
  ctx.beginPath();
  ctx.moveTo(x - legW / 2, hipY);
  ctx.lineTo(x + legW / 2, hipY);
  ctx.lineTo(kneeX + legW * 0.38, kneeY);
  ctx.lineTo(kneeX - legW * 0.38, kneeY);
  ctx.closePath();
  ctx.fill();

  // Shin: knee → foot (grounded, y = 0).
  ctx.beginPath();
  ctx.moveTo(kneeX - legW * 0.36, kneeY);
  ctx.lineTo(kneeX + legW * 0.36, kneeY);
  ctx.lineTo(x + legW * 0.38, 0);
  ctx.lineTo(x - legW * 0.38, 0);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(x, 0, legW * 0.55, legW * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * A mid-stride leg: bent at a "knee" and arcing off the ground, driven by `progress`
 * (0 → 1, normalized position through the current step — see `stridePhase` below).
 * `progress` 0 and 1 both touch down at the resting hip line (continuous with the leg
 * becoming/having just been the planted leg either side of a step boundary, so there's
 * no pop at the swap); the arc peaks (max knee bend + max lift) at `progress` 0.5.
 */
function drawSwingingLeg(
  ctx: CanvasRenderingContext2D,
  leg: SteppingLeg,
  hipY: number,
  hipHalf: number,
  legLen: number,
  legW: number,
  progress: number,
  tone: string,
  shade: string,
): void {
  const x = legAnchorX(leg, hipHalf);
  // Lift: 0 (grounded) at the step boundaries, peaks at mid-stride — sells the knee
  // bending and the foot leaving the ground.
  const lift = Math.sin(progress * Math.PI);
  // Reach: eases from "trailing" to "leading" across the stride (not a linear ramp, so
  // the foot decelerates into its landing rather than snapping to a stop).
  const reach = (1 - Math.cos(progress * Math.PI)) / 2;
  const outward = leg === "left" ? -1 : 1;
  const trailX = x - outward * legW * 0.7;
  const leadX = x + outward * legW * 1.5;
  const footX = trailX + (leadX - trailX) * reach;
  const footY = -lift * legLen * 0.42; // negative = above the ground line
  const kneeX = (x + footX) / 2 + outward * legW * 0.35 * lift;
  const kneeY = hipY + legLen * (0.58 - lift * 0.2);

  const grad = ctx.createLinearGradient(x - legW / 2, hipY, x + legW / 2, hipY);
  grad.addColorStop(0, shade);
  grad.addColorStop(0.5, tone);
  grad.addColorStop(1, shade);
  ctx.fillStyle = grad;

  // Thigh: hip → knee.
  ctx.beginPath();
  ctx.moveTo(x - legW / 2, hipY);
  ctx.lineTo(x + legW / 2, hipY);
  ctx.lineTo(kneeX + legW * 0.32, kneeY);
  ctx.lineTo(kneeX - legW * 0.32, kneeY);
  ctx.closePath();
  ctx.fill();

  // Shin: knee → foot.
  ctx.beginPath();
  ctx.moveTo(kneeX - legW * 0.3, kneeY);
  ctx.lineTo(kneeX + legW * 0.3, kneeY);
  ctx.lineTo(footX + legW * 0.34, footY);
  ctx.lineTo(footX - legW * 0.34, footY);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(footX, footY, legW * 0.5, legW * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * One swinging arm, anchored at the shoulder and rotated about that anchor by
 * `swingRad` (small angle, forward = negative i.e. leaning back toward the head side of
 * the pivot... see call site for the sign convention). Purely decorative counter-swing —
 * drawn in the figure's already-rotated local frame (nested `ctx.rotate` inside the outer
 * `angleRad` transform), so it leans/rotates as one piece with the whole body, never
 * independently of the lean. Gradient-shaded to match the torso/legs.
 */
function drawArm(
  ctx: CanvasRenderingContext2D,
  side: SteppingLeg,
  shoulderY: number,
  shoulderHalf: number,
  armLen: number,
  armW: number,
  swingRad: number,
  tone: string,
  shade: string,
): void {
  const x = side === "left" ? -shoulderHalf : shoulderHalf;
  ctx.save();
  ctx.translate(x, shoulderY);
  ctx.rotate(swingRad);
  const grad = ctx.createLinearGradient(-armW / 2, 0, armW / 2, 0);
  grad.addColorStop(0, shade);
  grad.addColorStop(0.5, tone);
  grad.addColorStop(1, shade);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-armW / 2, 0);
  ctx.lineTo(armW / 2, 0);
  ctx.lineTo(armW * 0.32, armLen);
  ctx.lineTo(-armW * 0.32, armLen);
  ctx.closePath();
  ctx.fill();
  // Hand.
  ctx.beginPath();
  ctx.ellipse(0, armLen, armW * 0.42, armW * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Linear-interpolated half-width of the walkway at a given depth (0 = horizon, 1 = feet). */
function halfWidthAt(depth: number): number {
  return GROUND_TOP_HALF_WIDTH + (GROUND_BOTTOM_HALF_WIDTH - GROUND_TOP_HALF_WIDTH) * depth;
}

/** Y coordinate for a given depth (0 = horizon, 1 = feet), eased so near rungs spread out
 * (perspective) rather than being evenly spaced like a flat grid. */
function yAt(depth: number): number {
  return HORIZON_Y + (RES - HORIZON_Y) * depth ** 1.6;
}

/**
 * Depth (0 = horizon .. 1 = feet) for recycled-slot `i` of `slotCount`, evenly
 * phase-offset so each slot continuously traverses the FULL horizon→feet range
 * — approaching the viewer smoothly, then recycling once it passes depth 1 — rather
 * than being confined to a fixed 1/slotCount band of the road.
 *
 * A naive `(i + 1 - f) / slotCount` (f = fractional progress through one spacing
 * cycle) instead traps slot `i` inside its own static band, DECREASING toward the
 * horizon as distance advances (backwards — objects should approach, not recede)
 * and, worse, snapping back to the top of its band once per cycle. Because every
 * slot shares the same `f`, that snap lands slot `i` almost exactly where slot
 * `i - 1` sat a moment earlier — read as two sprites popping in on top of each
 * other, most visible on large distinct sprites like trees (present but harder to
 * notice on the plain rung lines / speckle texture, which have the same bug).
 *
 * This formula avoids that: `depth` for each slot increases monotonically and
 * continuously with `distance` (via `%1` wraparound, not a per-cycle reset), and
 * two slots are never at the same depth at the same instant (they're always
 * exactly `1/slotCount` apart, mod 1).
 */
function recycledDepth(
  slotIndex: number,
  slotCount: number,
  distance: number,
  spacingUnits: number,
  reducedMotion: boolean,
): number {
  const f = reducedMotion ? 0 : distance / spacingUnits;
  const raw = slotIndex / slotCount + f;
  return raw - Math.floor(raw);
}

// ---------------------------------------------------------------------------
// Scenery assets — hand-authored inline SVGs, preloaded once (module scope)
// into `Image` objects and painted per-frame via `ctx.drawImage`, replacing
// the tree/speckle procedural draw calls that used to live here. Colors are
// baked directly into the SVG markup rather than threaded from the live
// theme (a real limitation vs. the old procedural version, which read CSS
// custom properties) — picked to read reasonably against both the light and
// dark `sky`/`skyDeep` tokens in `readPalette` above.
// ---------------------------------------------------------------------------

/** Wrap raw SVG markup as a `data:` URI Canvas can `drawImage` once loaded
 * into an `Image`. `charset=utf-8,` + `encodeURIComponent` avoids the extra
 * base64 encode/decode step. */
function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Kicks off loading immediately (`new Image()` + `src =`) and returns the
 * element right away — callers check `.complete` before drawing each frame
 * rather than awaiting a promise, since `draw()` is a synchronous, per-frame
 * function with no async step of its own. Safe to call at module scope: in
 * non-browser/test environments (jsdom) `Image` exists but never actually
 * decodes, so `.complete` simply stays `false` forever and callers just skip
 * painting that asset — same "don't throw, just don't paint yet" posture as
 * the `!canvas || !ctx` guard in the mount effect below. */
function loadSvgImage(svg: string): HTMLImageElement {
  const img = new Image();
  img.src = svgDataUri(svg);
  return img;
}

/** Two slightly different tree sprites (trunk + gradient-shaded canopy,
 * viewBox 40x60 — trunk base at the bottom edge) alternated per roadside
 * slot below so recycled trees don't read as identical stamped clones,
 * without needing a per-slot RNG. */
const TREE_SVGS = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60">
    <defs>
      <linearGradient id="trunk" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#3a2718"/>
        <stop offset="0.5" stop-color="#6b4a30"/>
        <stop offset="1" stop-color="#3a2718"/>
      </linearGradient>
      <radialGradient id="canopy" cx="35%" cy="32%" r="68%">
        <stop offset="0" stop-color="#3f8f4d"/>
        <stop offset="1" stop-color="#1c4d26"/>
      </radialGradient>
    </defs>
    <rect x="17" y="34" width="6" height="26" fill="url(#trunk)"/>
    <circle cx="20" cy="24" r="20" fill="url(#canopy)"/>
  </svg>`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60">
    <defs>
      <linearGradient id="trunk" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#3a2718"/>
        <stop offset="0.5" stop-color="#7c5a3e"/>
        <stop offset="1" stop-color="#3a2718"/>
      </linearGradient>
      <radialGradient id="canopy" cx="42%" cy="28%" r="72%">
        <stop offset="0" stop-color="#4fae5c"/>
        <stop offset="1" stop-color="#2f7a3d"/>
      </radialGradient>
    </defs>
    <rect x="16" y="30" width="7" height="30" fill="url(#trunk)"/>
    <ellipse cx="19.5" cy="21" rx="18.5" ry="21" fill="url(#canopy)"/>
  </svg>`,
].map(loadSvgImage);

/** A small tileable asphalt-speckle texture (transparent background — it's
 * layered ON TOP of the procedural asphalt/asphaltFar gradient fill below,
 * not replacing it, so that gradient's near/far depth shading — which still
 * reads live theme tokens — stays intact). Dot positions are "random but
 * fixed", hand-picked directly in the markup rather than generated. */
const GROUND_TEXTURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <circle cx="5" cy="8" r="1.1" fill="#e8eaf0" fill-opacity="0.3"/>
  <circle cx="14" cy="4" r="0.7" fill="#05070f" fill-opacity="0.35"/>
  <circle cx="24" cy="12" r="1.3" fill="#e8eaf0" fill-opacity="0.22"/>
  <circle cx="33" cy="6" r="0.8" fill="#05070f" fill-opacity="0.3"/>
  <circle cx="42" cy="15" r="1" fill="#e8eaf0" fill-opacity="0.28"/>
  <circle cx="8" cy="20" r="0.9" fill="#05070f" fill-opacity="0.32"/>
  <circle cx="19" cy="24" r="1.2" fill="#e8eaf0" fill-opacity="0.24"/>
  <circle cx="29" cy="21" r="0.7" fill="#05070f" fill-opacity="0.3"/>
  <circle cx="38" cy="27" r="1.1" fill="#e8eaf0" fill-opacity="0.26"/>
  <circle cx="45" cy="33" r="0.8" fill="#05070f" fill-opacity="0.3"/>
  <circle cx="3" cy="34" r="1" fill="#e8eaf0" fill-opacity="0.24"/>
  <circle cx="12" cy="38" r="0.7" fill="#05070f" fill-opacity="0.32"/>
  <circle cx="22" cy="40" r="1.3" fill="#e8eaf0" fill-opacity="0.2"/>
  <circle cx="32" cy="36" r="0.9" fill="#05070f" fill-opacity="0.3"/>
  <circle cx="40" cy="44" r="1" fill="#e8eaf0" fill-opacity="0.26"/>
  <circle cx="16" cy="14" r="0.6" fill="#05070f" fill-opacity="0.28"/>
</svg>`;
const GROUND_TEXTURE_IMAGE = loadSvgImage(GROUND_TEXTURE_SVG);

const TREE_SPACING_UNITS = 14; // world "distance" per tree slot, sparser than the rungs
const TREE_SLOTS_PER_SIDE = 3; // recycled slots -> ~6 trees on screen at once

// Ground texture is tiled in horizontal "bands" recycled the same way the
// trees' slots are, rather than per-speckle — a full asphalt-texture image
// is harder to recycle seamlessly per-dot than discrete sprites, so instead
// of computing individual speckle positions in JS each frame (the old
// approach) we scroll a handful of stretched copies of one small tile up
// the ground plane, clipped to the trapezoid so nothing spills onto the sky.
const GROUND_TEXTURE_ROWS = 8;
const GROUND_TEXTURE_SPACING_UNITS = 10;

/** A single roadside tree sprite, scaled by `depth` the same way `halfWidthAt`
 * scales rung width, drawn from a preloaded `Image` instead of shape-by-shape
 * Canvas calls. `sideX` is the screen-space x of the roadside edge the tree
 * anchors outward from (left edge -> negative outward, right edge ->
 * positive outward). No-ops (skips the frame) if the image hasn't finished
 * loading yet — same posture as the missing-2D-context guard below. */
function drawTree(
  ctx: CanvasRenderingContext2D,
  depth: number,
  sideX: number,
  outward: 1 | -1,
  variantIndex: number,
): void {
  const img = TREE_SVGS[variantIndex % TREE_SVGS.length];
  if (!img || !img.complete || img.naturalWidth === 0) return;

  const y = yAt(depth);
  const scale = 0.4 + depth * 1.4;
  const drawH = 46 * scale;
  const drawW = (40 / 60) * drawH; // preserve the sprite's 40:60 viewBox aspect
  const margin = 6 * scale;
  const x = sideX + outward * margin;

  ctx.save();
  ctx.globalAlpha = 0.35 + depth * 0.65;
  // Trunk base flush with the ground line at `y`, matching where the old
  // procedural trunk's `fillRect` bottom edge sat.
  ctx.drawImage(img, x - drawW / 2, y - drawH, drawW, drawH);
  ctx.restore();
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: DrunkWalkState,
  score: number,
  reducedMotion: boolean,
  palette: Palette,
): void {
  // Clear the full frame first. The sky fill below only covers the strip above the
  // horizon, and the ground fill only covers the walkway trapezoid — but trees are
  // deliberately drawn OUTSIDE that trapezoid, in the side margins below the horizon.
  // Without an explicit clear, that side-margin region is never repainted between
  // frames, so every previous frame's tree draws (at every position they ever
  // scrolled through) just accumulate — reads as trees piling up/rendering on top of
  // each other as they move. Same risk applies to anything else ever drawn outside
  // the sky/ground fills, so clear unconditionally rather than patching per-element.
  ctx.clearRect(0, 0, RES, RES);

  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
  sky.addColorStop(0, palette.skyDeep);
  sky.addColorStop(1, palette.sky);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, RES, HORIZON_Y);

  // Roadside trees, scrolling toward the viewer via `state.distance` exactly like the
  // rungs below (a fixed set of recycled "slots" whose depth cycles). Drawn BEFORE the
  // ground plane fill so the asphalt correctly overlaps/grounds their trunk bases at the
  // roadside edge, rather than floating on top of it — far-depth trees first, near-depth
  // last, so nearer trees correctly occlude farther ones. Purely decorative scenery, so
  // frozen (statically placed, not removed) under reduced motion, same treatment as the
  // rung scroll.
  const treeDepths: number[] = [];
  for (let i = 0; i < TREE_SLOTS_PER_SIDE; i++) {
    treeDepths.push(
      recycledDepth(i, TREE_SLOTS_PER_SIDE, state.distance, TREE_SPACING_UNITS, reducedMotion),
    );
  }
  // Far first (small index in the sorted-by-depth-ascending sense is "far"; depth itself
  // already runs 0=horizon..1=feet, so ascending depth IS far-to-near).
  const orderedSlots = treeDepths
    .map((depth, i) => ({ depth, i }))
    .sort((a, b) => a.depth - b.depth);
  for (const { depth, i } of orderedSlots) {
    if (depth <= 0 || depth > 1) continue;
    const hw = halfWidthAt(depth);
    drawTree(ctx, depth, RES / 2 - hw, -1, i);
    drawTree(ctx, depth, RES / 2 + hw, 1, TREE_SLOTS_PER_SIDE + i);
  }

  // Ground plane: a foreshortened trapezoid receding to a vanishing point on
  // the horizon, shaded lighter near the viewer for a cheap depth cue. Asphalt
  // charcoal, not the sky's blue-toned dark — see the `asphalt`/`asphaltFar`
  // palette entries.
  const ground = ctx.createLinearGradient(0, HORIZON_Y, 0, RES);
  ground.addColorStop(0, palette.asphaltFar);
  ground.addColorStop(1, palette.asphalt);
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.moveTo(RES / 2 - GROUND_TOP_HALF_WIDTH, HORIZON_Y);
  ctx.lineTo(RES / 2 + GROUND_TOP_HALF_WIDTH, HORIZON_Y);
  ctx.lineTo(RES / 2 + GROUND_BOTTOM_HALF_WIDTH, RES);
  ctx.lineTo(RES / 2 - GROUND_BOTTOM_HALF_WIDTH, RES);
  ctx.closePath();
  ctx.fill();

  // Asphalt speckle texture: the `GROUND_TEXTURE_IMAGE` SVG tile stretched across
  // recycled horizontal "bands" up the ground plane (same recycled-slot scroll
  // pattern the trees use above), clipped to the ground trapezoid so nothing spills
  // onto the sky. This replaces the old per-frame loop that computed each speckle
  // dot's position individually — a full-width tiled image is simpler to recycle
  // seamlessly than trying to scroll dozens of discrete dots.
  if (GROUND_TEXTURE_IMAGE.complete && GROUND_TEXTURE_IMAGE.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(RES / 2 - GROUND_TOP_HALF_WIDTH, HORIZON_Y);
    ctx.lineTo(RES / 2 + GROUND_TOP_HALF_WIDTH, HORIZON_Y);
    ctx.lineTo(RES / 2 + GROUND_BOTTOM_HALF_WIDTH, RES);
    ctx.lineTo(RES / 2 - GROUND_BOTTOM_HALF_WIDTH, RES);
    ctx.closePath();
    ctx.clip();

    for (let i = 0; i < GROUND_TEXTURE_ROWS; i++) {
      const depth = recycledDepth(
        i,
        GROUND_TEXTURE_ROWS,
        state.distance,
        GROUND_TEXTURE_SPACING_UNITS,
        reducedMotion,
      );
      if (depth <= 0 || depth > 1) continue;
      const hw = halfWidthAt(depth);
      const y = yAt(depth);
      const rowH = Math.max(4, 44 * depth) / GROUND_TEXTURE_ROWS + 6;
      ctx.globalAlpha = 0.5 + depth * 0.5;
      ctx.drawImage(GROUND_TEXTURE_IMAGE, RES / 2 - hw, y - rowH / 2, hw * 2, rowH);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Perspective "rungs" scrolling toward the viewer as distance increases —
  // sells forward motion (endless-runner framing). Purely decorative, so
  // frozen under reduced motion (no non-essential motion, ADR §5) — the score
  // readout already carries distance as text.
  const RUNG_COUNT = 7;
  const SPACING_UNITS = 6; // world "distance" per rung, tuned to a readable cadence
  ctx.strokeStyle = palette.rung;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < RUNG_COUNT; i++) {
    const depth = recycledDepth(i, RUNG_COUNT, state.distance, SPACING_UNITS, reducedMotion);
    if (depth <= 0 || depth > 1) continue;
    const y = yAt(depth);
    const hw = halfWidthAt(depth);
    ctx.globalAlpha = 0.3 + depth * 0.4;
    ctx.beginPath();
    ctx.moveTo(RES / 2 - hw, y);
    ctx.lineTo(RES / 2 + hw, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Tap-zone divider: a subtle dashed centerline down the full surface, with a
  // small L/R glyph in each half — not color-only (shape + text), obvious on
  // touch. Always drawn (structural, not decorative motion).
  ctx.save();
  ctx.strokeStyle = palette.ink;
  ctx.globalAlpha = 0.18;
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(RES / 2, HORIZON_Y);
  ctx.lineTo(RES / 2, RES);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.font = `700 ${RES * 0.05}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.left;
  ctx.fillText("◀ L", RES * 0.22, RES * 0.86);
  ctx.fillStyle = palette.right;
  ctx.fillText("R ▶", RES * 0.78, RES * 0.86);
  ctx.restore();

  // The figure: a simple pivoting body — the ground pivot at the walkway's
  // near edge is the foot line the legs plant on, hips/torso/head stacked
  // above it, leaning by `state.angle`. Rotation here is the CORE gameplay
  // signal (not decorative), so it is always drawn at the true angle,
  // reduced-motion or not — only the ambient scroll above (and, per its own
  // comment below, the leg swing) is dropped, per ADR §5 ("swap animation for
  // instant state change" applies to decorative motion, not to essential
  // state feedback).
  const pivotX = RES / 2;
  const pivotY = RES * 0.94;
  const bodyH = RES * 0.34;
  const bodyW = RES * 0.09;
  const angleRad = (state.angle * Math.PI) / 180;

  // Gait: `steppingLeg` is whichever leg is currently planted/weight-bearing (see
  // DrunkWalkState doc); the other leg is mid-swing. Stride phase (0 → 1) is derived
  // from `t` per the engine's contract — no separate "mid-stride" flag exists. Under
  // reduced motion the swing is dropped in favor of a neutral standing pose (both legs
  // planted), the same "essential state stays, decorative motion drops" treatment
  // already applied to the scrolling rungs above.
  const legLen = bodyH * 0.56;
  const hipY = -legLen; // torso/head now sit one leg-length above the ground pivot
  const hipHalf = bodyW * 0.32;
  const legW = bodyW * 0.46;
  const plantedLeg: SteppingLeg = state.steppingLeg;
  const swingingLeg: SteppingLeg = plantedLeg === "left" ? "right" : "left";
  const strideProgress =
    (state.t % DRUNK_WALK_WORLD.stepIntervalTicks) / DRUNK_WALK_WORLD.stepIntervalTicks;
  // How close to falling, 0 (upright) → 1 (about to fail) — a non-color-only
  // cue (also shrinks the ground shadow below) layered on top of the always-
  // accurate rotation, so "about to fall" reads even to someone who can't
  // distinguish the tint shift.
  const danger = dangerFraction(state.angle);

  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(angleRad);

  const bodyTone = danger > 0.6 ? palette.danger : palette.figure;

  // Legs, drawn first so the torso's hem overlaps their tops. Both anchor at the hip
  // line (`hipY`) and rotate as one rigid piece with the torso/head (they're drawn in
  // the same already-rotated local frame, not independently), so the whole figure reads
  // as one coherent leaning-while-walking body.
  if (reducedMotion) {
    // Neutral standing stance — no per-tick swing, consistent with freezing the
    // decorative rung-scroll above under reduced motion.
    drawPlantedLeg(ctx, "left", hipY, hipHalf, legW, bodyTone, palette.figureShade);
    drawPlantedLeg(ctx, "right", hipY, hipHalf, legW, bodyTone, palette.figureShade);
  } else {
    drawPlantedLeg(ctx, plantedLeg, hipY, hipHalf, legW, bodyTone, palette.figureShade);
    drawSwingingLeg(
      ctx,
      swingingLeg,
      hipY,
      hipHalf,
      legLen,
      legW,
      strideProgress,
      bodyTone,
      palette.figureShade,
    );
  }

  // Torso: a vertical capsule with a gradient across its width for pseudo-3D
  // (cylindrical) shading, independent of the lean color-coding above. Tints
  // toward the danger color as the lean nears the fail threshold.
  const torsoGrad = ctx.createLinearGradient(-bodyW / 2, 0, bodyW / 2, 0);
  torsoGrad.addColorStop(0, palette.figureShade);
  torsoGrad.addColorStop(0.5, bodyTone);
  torsoGrad.addColorStop(1, palette.figureShade);
  ctx.fillStyle = torsoGrad;
  ctx.beginPath();
  ctx.moveTo(-bodyW / 2, hipY);
  ctx.lineTo(-bodyW / 2, hipY - bodyH * 0.78);
  ctx.quadraticCurveTo(-bodyW / 2, hipY - bodyH * 0.9, 0, hipY - bodyH * 0.9);
  ctx.quadraticCurveTo(bodyW / 2, hipY - bodyH * 0.9, bodyW / 2, hipY - bodyH * 0.78);
  ctx.lineTo(bodyW / 2, hipY);
  ctx.closePath();
  ctx.fill();

  // Arms: anchored at the shoulders (above the hip/torso anchor), swinging in sync with
  // the gait cycle. Gait convention (natural contralateral walking swing): the arm on the
  // SAME side as the currently-swinging leg swings backward as that leg swings forward,
  // and the opposite arm (same side as the planted leg) swings forward — mirrors of the
  // same `reach` curve already used to drive the swinging leg's foot, so both arms share
  // its easing (decelerate into the end of the swing) and stay continuous across step
  // boundaries (no pop when the planted/swinging legs swap sides), same as the legs.
  // Nested `ctx.rotate` per arm is scoped inside this already-rotated figure transform,
  // so arms lean/rotate as one piece with the whole body, never independently of it.
  const shoulderY = hipY - bodyH * 0.62;
  const shoulderHalf = bodyW * 0.46;
  const armLen = bodyH * 0.48;
  const armW = legW * 0.72;
  const maxArmSwing = (24 * Math.PI) / 180;
  const reach = (1 - Math.cos(strideProgress * Math.PI)) / 2; // 0 (trailing) → 1 (leading)
  const swingUnit = reducedMotion ? 0 : 1 - 2 * reach; // +1 forward → -1 backward
  const swingingArmRad = -swingUnit * maxArmSwing;
  const plantedArmRad = swingUnit * maxArmSwing;
  const swingingArmSide: SteppingLeg = reducedMotion ? "left" : swingingLeg;
  const plantedArmSide: SteppingLeg = reducedMotion ? "right" : plantedLeg;
  drawArm(
    ctx,
    plantedArmSide,
    shoulderY,
    shoulderHalf,
    armLen,
    armW,
    plantedArmRad,
    bodyTone,
    palette.figureShade,
  );
  drawArm(
    ctx,
    swingingArmSide,
    shoulderY,
    shoulderHalf,
    armLen,
    armW,
    swingingArmRad,
    bodyTone,
    palette.figureShade,
  );

  // Head.
  const headR = bodyW * 0.62;
  const headY = hipY - bodyH * 0.92 - headR * 0.6;
  const headGrad = ctx.createRadialGradient(
    -headR * 0.3,
    headY - headR * 0.3,
    headR * 0.1,
    0,
    headY,
    headR,
  );
  headGrad.addColorStop(0, palette.figure);
  headGrad.addColorStop(1, palette.figureShade);
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // A short shadow anchored at the (unrotated) pivot — grounds the figure so
  // the lean reads as "about to fall over", not "floating at an angle". Shrinks
  // as `danger` rises (heels lifting), a shape cue alongside the tint above.
  ctx.fillStyle = palette.ink;
  ctx.globalAlpha = 0.15;
  ctx.beginPath();
  ctx.ellipse(
    pivotX,
    pivotY + 4,
    bodyW * 0.9 * (1 - danger * 0.5),
    bodyW * 0.28,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  // Score, drawn large + centered at the top (also shown as accessible text on
  // the screen; this is the in-world arcade readout).
  ctx.fillStyle = palette.ink;
  ctx.font = `700 ${RES * 0.021}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(String(score), RES / 2, RES * 0.012);
}

export function DrunkWalkScene({
  state,
  score,
  reducedMotion,
}: RealtimeSceneProps<DrunkWalkState>): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    // No 2D context (e.g. jsdom) → no-op; the screen's accessible state stands
    // on its own, so the game still "runs", it just isn't painted.
    if (!canvas || !ctx) return;

    // Match the raster backing store to the device's pixel density. Without this the
    // canvas's backing store stays a fixed RESxRES raster (CSS device-independent
    // pixels) while the CSS box (`.canvas { width/height: 100% }`, up to 480 CSS px per
    // `RealtimePlayScreen`) is displayed at `devicePixelRatio` physical pixels — on any
    // HiDPI screen (2x/3x, i.e. virtually all modern laptops/phones/tablets) the browser
    // then upscales that raster, softening every edge. That blur is most visible on the
    // head: it's the smallest, tightest-curved shape with the highest-contrast gradient
    // (bright warm center against the dark sky), so the soft edge reads as "color
    // spilling outside the silhouette" — worse at extreme lean angles because the
    // rotated head then overlaps busier, higher-contrast background (the ground/sky
    // seam, dashed centerline, rungs), making the same constant blur ring more visually
    // obvious. Fix: size the backing store in physical pixels and scale the context back
    // down, so all drawing math below still happens in the original RES-unit space.
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(RES * dpr);
    const targetH = Math.round(RES * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    draw(ctx, state, score, reducedMotion, readPalette(canvas));
  }, [state, score, reducedMotion]);

  return (
    <canvas ref={canvasRef} width={RES} height={RES} className={styles.canvas} aria-hidden="true" />
  );
}
