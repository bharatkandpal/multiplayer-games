import { useEffect, useRef } from "react";
import { DRUNK_WALK_WORLD, type DrunkWalkState, type SteppingLeg } from "@mpg/engine";
import type { RealtimeSceneProps } from "../../screens/RealtimePlayScreen";
import {
  DEFAULT_DRUNK_WALK_CHARACTER,
  findClothesColor,
  findHairColor,
  findShoeColor,
  findSkinTone,
  type DrunkWalkAccessory,
  type DrunkWalkBeard,
  type DrunkWalkCharacter,
  type DrunkWalkHair,
  type DrunkWalkHat,
} from "./drunkWalkCharacter";
import styles from "./DrunkWalkScene.module.css";

/** How close to the fail threshold the lean is, 0 (upright) → 1 (about to fall). */
function dangerFraction(angle: number): number {
  return Math.min(1, Math.abs(angle) / DRUNK_WALK_WORLD.failAngleDeg);
}

/**
 * Overshoot-then-settle easing for the post-fall flourish (0 → 1 in,
 * momentarily > 1 out, back to 1): a real body toppling over doesn't stop
 * dead at "lying down", it rocks past it a little first. https://easings.net/#easeOutBack
 */
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
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
 * a horizon, gradient shading on the figure, and a scrolling asphalt texture +
 * roadside trees to sell forward motion — all cheap 2D tricks. The figure
 * stays purely procedural (imperative Canvas draw calls); the roadside trees
 * and the asphalt ground texture are instead small hand-authored inline SVG
 * "sprites" (see `TREE_SVGS`/`GROUND_TEXTURE_SVG` below), preloaded once into
 * `Image` objects at module scope and painted via `ctx.drawImage`.
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

// Every scrolling layer (trees, ground texture) is driven off
// `state.distance * VISUAL_SCROLL_SCALE` rather than raw `state.distance` —
// decoupled from the engine's forward speed (which also drives score, see
// WORLD.forwardSpeedPerTick). Scaling it down here is purely a rendering
// choice (a slower-feeling walkway) and never touches
// `DrunkWalkState`/scoring/the replay log, so it can't affect the server-side
// re-simulation anti-cheat check (MPG-065). Tuned down per playtest feedback
// that the world scrolled by too fast to read.
const VISUAL_SCROLL_SCALE = 0.45;

// How long (ms) the fall-and-settle flourish runs once `state.over` flips
// true, before the character comes to rest lying down. Purely decorative —
// see the `fallProgress` plumbing in `draw()` below. Held for a couple of
// seconds (rather than a quick beat) so the fall — and the overlay's matching
// reveal delay in `RealtimePlayScreen.module.css` — actually reads before
// "Play again" covers the scene.
const FALL_SETTLE_MS = 2000;

interface Palette {
  sky: string;
  skyDeep: string;
  /** Asphalt near the viewer (bottom of the ground trapezoid) — lighter than `asphaltFar`. */
  asphalt: string;
  /** Asphalt at the horizon (top of the ground trapezoid) — darker, blends with the sky. */
  asphaltFar: string;
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
    // Dedicated tokens rather than reusing --color-text-muted/--color-bg-inset: those
    // are shared, semantically-neutral tokens already assigned elsewhere in this
    // palette, so borrowing them here would either couple the road color to the sky's
    // or drift with unrelated text-contrast tuning. Dark asphalt charcoal, lightening
    // slightly toward the viewer.
    asphalt: v("--color-asphalt", "#3f4045"),
    asphaltFar: v("--color-asphalt-far", "#2a2b2f"),
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
  shoeTone: string,
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

  // Foot/shoe — its own flat color (the player's shoe pick), not the leg's
  // tone/shade gradient, so shoes read as a distinct customizable part.
  ctx.fillStyle = shoeTone;
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
  shoeTone: string,
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

  // Foot/shoe — its own flat color, same convention as the planted leg above.
  ctx.fillStyle = shoeTone;
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
  skinTone: string,
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
  // Hand — skin-toned rather than sleeve-toned, so it reads as skin peeking
  // out of a sleeve instead of a same-colored mitten.
  ctx.fillStyle = skinTone;
  ctx.beginPath();
  ctx.ellipse(0, armLen, armW * 0.42, armW * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The chosen hat, drawn on/above the head in the figure's already-rotated
 * local frame (same convention as the arms/legs) so it leans with the whole
 * body. Purely decorative — never read by the engine. `tone`/`shade` are the
 * clothes color (hats aren't independently colored — one fewer picker, and
 * it keeps the hat visually coordinated with the outfit).
 */
function drawHat(
  ctx: CanvasRenderingContext2D,
  hat: DrunkWalkHat,
  headR: number,
  headY: number,
  tone: string,
  shade: string,
): void {
  if (hat === "none") return;

  if (hat === "cap") {
    // A simple baseball-style cap: a dome over the top half of the head plus
    // a brim poking out toward the "front" (the same side the character's
    // face implicitly points, +x in this local frame).
    const domeGrad = ctx.createLinearGradient(-headR, headY - headR, headR, headY - headR * 0.3);
    domeGrad.addColorStop(0, shade);
    domeGrad.addColorStop(1, tone);
    ctx.fillStyle = domeGrad;
    ctx.beginPath();
    ctx.arc(0, headY - headR * 0.15, headR * 1.05, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    // Brim.
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(headR * 0.75, headY - headR * 0.15, headR * 0.55, headR * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (hat === "party-hat") {
    const grad = ctx.createLinearGradient(0, headY - headR * 2.2, 0, headY - headR * 0.7);
    grad.addColorStop(0, shade);
    grad.addColorStop(1, tone);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-headR * 0.7, headY - headR * 0.7);
    ctx.lineTo(headR * 0.7, headY - headR * 0.7);
    ctx.lineTo(0, headY - headR * 2.2);
    ctx.closePath();
    ctx.fill();
    // Pom-pom.
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(0, headY - headR * 2.2, headR * 0.22, headR * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Halo: a tilted ring hovering above the head, plus a twinkle — a little
  // whimsical, deliberately not a "realistic" object.
  ctx.strokeStyle = tone;
  ctx.lineWidth = headR * 0.16;
  ctx.beginPath();
  ctx.ellipse(0, headY - headR * 1.7, headR * 0.85, headR * 0.28, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = tone;
  ctx.font = `${headR * 0.6}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("✦", headR * 1.3, headY - headR * 0.6);
}

/**
 * The chosen hairstyle, drawn on the head BEFORE the face/beard/hat/accessory
 * (same local frame as `drawHat`) so a hat or headphones band can naturally
 * sit on top of it and a beard still reads as separate from head hair. A
 * hat's brim/dome is drawn over whatever hair is here regardless of style —
 * a known simplification (no "hair peeking out from under a cap"), same
 * spirit as the hat always using the clothes color rather than growing its
 * own render branch per hair+hat combination.
 */
function drawHair(
  ctx: CanvasRenderingContext2D,
  hair: DrunkWalkHair,
  headR: number,
  headY: number,
  tone: string,
  shade: string,
): void {
  if (hair === "none") return;

  if (hair === "short") {
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(0, headY - headR * 0.1, headR * 1.04, Math.PI * 1.08, Math.PI * 1.92);
    ctx.fill();
    return;
  }

  if (hair === "long") {
    // Short cap on top plus two drooping "wings" down past the shoulders on
    // either side — reads as long hair even at glyph-menu sizes.
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(0, headY - headR * 0.1, headR * 1.04, Math.PI * 1.08, Math.PI * 1.92);
    ctx.fill();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * headR * 0.95, headY - headR * 0.2);
      ctx.quadraticCurveTo(
        side * headR * 1.35,
        headY + headR * 0.9,
        side * headR * 0.75,
        headY + headR * 1.7,
      );
      ctx.lineTo(side * headR * 0.35, headY + headR * 1.6);
      ctx.quadraticCurveTo(side * headR * 0.75, headY + headR * 0.7, side * headR * 0.55, headY);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }

  if (hair === "bun") {
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(0, headY - headR * 0.1, headR * 1.04, Math.PI * 1.08, Math.PI * 1.92);
    ctx.fill();
    // The bun itself, toward the back of the head (-x, "away" from the
    // implicit +x face direction).
    ctx.beginPath();
    ctx.ellipse(-headR * 0.65, headY - headR * 0.75, headR * 0.34, headR * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Mohawk: a jagged center strip front-to-back, using `tone` for the
  // brighter tips so it pops against the `shade` base — the one hairstyle
  // that's meant to look loud rather than natural.
  ctx.fillStyle = shade;
  const tipCount = 5;
  const startX = -headR * 0.8;
  const stepX = (headR * 1.6) / (tipCount - 1);
  for (let i = 0; i < tipCount; i++) {
    const cx = startX + i * stepX;
    const spikeH = headR * (i % 2 === 0 ? 0.85 : 0.6);
    ctx.beginPath();
    ctx.moveTo(cx - stepX * 0.4, headY - headR * 0.5);
    ctx.lineTo(cx, headY - headR * 0.5 - spikeH);
    ctx.lineTo(cx + stepX * 0.4, headY - headR * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.ellipse(cx, headY - headR * 0.5 - spikeH, headR * 0.08, headR * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade;
  }
}

/**
 * The chosen accessory, drawn AFTER the face/beard so glasses sit visibly on
 * top of the eyes, but before the hat so a hat can still sit above/overlap
 * headphones the way it would in life. Fixed neutral colors regardless of
 * outfit — same "not outfit, always reads as itself" reasoning as the beard.
 */
function drawAccessory(
  ctx: CanvasRenderingContext2D,
  accessory: DrunkWalkAccessory,
  headR: number,
  headY: number,
): void {
  if (accessory === "none") return;

  const eyeY = headY - headR * 0.08;
  const eyeOffsetX = headR * 0.38;

  if (accessory === "glasses" || accessory === "sunglasses") {
    const lensR = headR * 0.22;
    ctx.save();
    ctx.strokeStyle = "#20242b";
    ctx.lineWidth = headR * 0.06;
    ctx.fillStyle = accessory === "sunglasses" ? "#20242bcc" : "#bfe0ff55";
    for (const ex of [-eyeOffsetX, eyeOffsetX]) {
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, lensR, lensR * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Bridge between the lenses.
    ctx.beginPath();
    ctx.moveTo(-eyeOffsetX + lensR, eyeY);
    ctx.lineTo(eyeOffsetX - lensR, eyeY);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Headphones: a band arcing over the top of the head plus two ear cups at
  // roughly eye height on either side.
  ctx.save();
  ctx.strokeStyle = "#2b2b30";
  ctx.lineWidth = headR * 0.16;
  ctx.beginPath();
  ctx.arc(0, headY, headR * 1.1, Math.PI * 1.12, Math.PI * 1.88);
  ctx.stroke();
  ctx.fillStyle = "#2b2b30";
  for (const ex of [-headR * 1.02, headR * 1.02]) {
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, headR * 0.22, headR * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The face's expression — driven by gameplay state (see call site), not a
 * customizable part: eyes + mouth read the character's current state
 * (`"calm"` normally, `"worried"` once the lean is getting dangerous,
 * `"dizzy"` once actually fallen), the same "state stays legible" spirit as
 * the body-color danger tint. */
export type DrunkWalkFaceExpression = "calm" | "worried" | "dizzy";

/**
 * Eyes + mouth, drawn on the head in the figure's already-rotated local
 * frame, BEFORE the beard (so a full beard can naturally cover the mouth,
 * same as a real beard would) and before the hat. Purely decorative.
 */
function drawFace(
  ctx: CanvasRenderingContext2D,
  headR: number,
  headY: number,
  expression: DrunkWalkFaceExpression,
): void {
  const eyeY = headY - headR * 0.08;
  const eyeOffsetX = headR * 0.38;
  const mouthY = headY + headR * 0.35;

  ctx.save();
  ctx.strokeStyle = "#1a1a1a";
  ctx.fillStyle = "#1a1a1a";
  ctx.lineWidth = headR * 0.09;
  ctx.lineCap = "round";

  // Eyes: two dots normally, an "X_X" knocked-out look once fallen.
  if (expression === "dizzy") {
    const armLen = headR * 0.13;
    for (const ex of [-eyeOffsetX, eyeOffsetX]) {
      ctx.beginPath();
      ctx.moveTo(ex - armLen, eyeY - armLen);
      ctx.lineTo(ex + armLen, eyeY + armLen);
      ctx.moveTo(ex - armLen, eyeY + armLen);
      ctx.lineTo(ex + armLen, eyeY - armLen);
      ctx.stroke();
    }
  } else {
    const eyeR = headR * 0.11;
    ctx.beginPath();
    ctx.ellipse(-eyeOffsetX, eyeY, eyeR, eyeR, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeOffsetX, eyeY, eyeR, eyeR, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mouth: a downward-curving smile when calm, a flat concerned line once the
  // lean is getting dangerous, a small round "o" of surprise once fallen.
  if (expression === "dizzy") {
    ctx.beginPath();
    ctx.ellipse(0, mouthY, headR * 0.15, headR * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (expression === "worried") {
    ctx.beginPath();
    ctx.moveTo(-headR * 0.22, mouthY);
    ctx.lineTo(headR * 0.22, mouthY);
    ctx.stroke();
  } else {
    ctx.beginPath();
    // The bottom arc of a circle centered slightly above the mouth line —
    // same "sweep through the bottom" trick as the full-beard arc below.
    ctx.arc(0, mouthY - headR * 0.18, headR * 0.28, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The chosen beard/facial-hair style, drawn on the lower half of the head in
 * the same rotated local frame as `drawHat`. Always a fixed dark hair color
 * (not the clothes color) — facial hair isn't "outfit", so it doesn't need
 * its own color picker to still read as intentional. Purely decorative.
 */
function drawBeard(
  ctx: CanvasRenderingContext2D,
  beard: DrunkWalkBeard,
  headR: number,
  headY: number,
): void {
  if (beard === "none") return;
  ctx.fillStyle = "#3a2a1a";

  if (beard === "mustache") {
    ctx.beginPath();
    ctx.ellipse(
      -headR * 0.3,
      headY + headR * 0.15,
      headR * 0.28,
      headR * 0.12,
      0.3,
      0,
      Math.PI * 2,
    );
    ctx.ellipse(
      headR * 0.3,
      headY + headR * 0.15,
      headR * 0.28,
      headR * 0.12,
      -0.3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    return;
  }

  if (beard === "goatee") {
    ctx.beginPath();
    ctx.moveTo(-headR * 0.35, headY + headR * 0.25);
    ctx.lineTo(headR * 0.35, headY + headR * 0.25);
    ctx.lineTo(headR * 0.2, headY + headR * 0.85);
    ctx.lineTo(-headR * 0.2, headY + headR * 0.85);
    ctx.closePath();
    ctx.fill();
    return;
  }

  // Full beard: covers the whole lower half of the head, following its curve.
  ctx.beginPath();
  ctx.arc(0, headY, headR * 1.02, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.closePath();
  ctx.fill();
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
 * other, most visible on large distinct sprites like trees.
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
// into `Image` objects and painted per-frame via `ctx.drawImage`. Colors are
// baked directly into the SVG markup rather than threaded from the live
// theme — picked to read reasonably against both the light and dark
// `sky`/`skyDeep` tokens in `readPalette` above.
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

// World "distance" per tree slot — deliberately much sparser than the ground
// texture (10): trees are large, high-contrast sprites whose size ramps up
// as they near the viewer (see `scale` in `drawTree` below), so the same
// positional speed as the road reads as visibly faster than the road (the
// "looming" effect dominates perceived speed more for a big sprite than for
// a small speckle). Set well above the road layer so trees read as moving at
// a pace RELATIVE TO the walking character — a background detail, not a
// competing motion — rather than racing past it.
const TREE_SPACING_UNITS = 50;
const TREE_SLOTS_PER_SIDE = 3; // recycled slots -> ~6 trees on screen at once

// Ground texture is tiled in horizontal "bands" recycled the same way the
// trees' slots are, rather than per-speckle — a full asphalt-texture image
// is harder to recycle seamlessly per-dot than discrete sprites, so instead
// of computing individual speckle positions in JS each frame we scroll a
// handful of stretched copies of one small tile up the ground plane, clipped
// to the trapezoid so nothing spills onto the sky.
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
  // Gentler size ramp than the old 0.4 -> 1.8 (a 4.5x grow toward the
  // viewer): that steep a "looming" curve read as trees rushing past faster
  // than the road even at a slower positional speed (see `TREE_SPACING_UNITS`
  // above) — perceived approach speed is dominated by rate-of-size-change as
  // much as by position.
  const scale = 0.55 + depth * 0.85;
  const drawH = 46 * scale;
  const drawW = (40 / 60) * drawH; // preserve the sprite's 40:60 viewBox aspect
  const margin = 6 * scale;
  const x = sideX + outward * margin;

  // Fade a tree out just before it reaches the viewer edge (depth -> 1) and
  // fade the next lap's tree in just after it appears at the horizon
  // (depth -> 0), rather than leaving it fully opaque right up to the
  // recycle point. Without this, a tree at max size/opacity one frame
  // instantly resets to tiny/far the next — a visible "pop" that reads as
  // the tree suddenly moving backward/away instead of smoothly recycling.
  const EDGE = 0.1;
  const edgeFade = Math.min(1, depth / EDGE, (1 - depth) / EDGE);
  ctx.save();
  ctx.globalAlpha = (0.35 + depth * 0.65) * Math.max(0, edgeFade);
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
  character: DrunkWalkCharacter,
  /** 0 (the instant the character falls) → 1 (settled lying down). Always 0
   * while `!state.over`, and stays 0 under reduced motion (see the component
   * below) — every use of it is guarded on `state.over && fallProgress > 0`,
   * so it's a pure no-op addition to the otherwise-unchanged draw. */
  fallProgress: number,
): void {
  // Clear the full frame first. The sky fill below only covers the strip above the
  // horizon, and the ground fill only covers the walkway trapezoid — but trees are
  // deliberately drawn OUTSIDE that trapezoid, in the side margins below the horizon.
  // Without an explicit clear, that side-margin region is never repainted between
  // frames, so every previous frame's tree draws just accumulate — reads as trees
  // piling up/rendering on top of each other as they move.
  ctx.clearRect(0, 0, RES, RES);

  // The world-distance signal every scrolling layer below is driven off —
  // decoupled from the raw engine distance per `VISUAL_SCROLL_SCALE` above.
  // Negated: `recycledDepth`'s depth normally INCREASES with distance (an
  // object starts at the horizon and approaches the viewer), which reads as
  // the camera chasing behind the character, walking AWAY into the screen.
  // Negating the input instead makes depth DECREASE with distance (an object
  // starts near the viewer and recedes toward the horizon) — the scenery
  // moving away sells the character advancing TOWARD a camera planted ahead
  // of it, rather than the camera following from behind.
  const scrollDistance = -(state.distance * VISUAL_SCROLL_SCALE);

  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
  sky.addColorStop(0, palette.skyDeep);
  sky.addColorStop(1, palette.sky);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, RES, HORIZON_Y);

  // Roadside trees, receding away from the viewer via `scrollDistance` (a fixed set of
  // recycled "slots" whose depth cycles — see the sign note above). Drawn BEFORE the
  // ground plane fill so the asphalt correctly overlaps/grounds their trunk bases at the
  // roadside edge, rather than floating on top of it — far-depth trees first, near-depth
  // last, so nearer trees correctly occlude farther ones. Purely decorative scenery, so
  // frozen (statically placed, not removed) under reduced motion.
  const treeDepths: number[] = [];
  for (let i = 0; i < TREE_SLOTS_PER_SIDE; i++) {
    treeDepths.push(
      recycledDepth(i, TREE_SLOTS_PER_SIDE, scrollDistance, TREE_SPACING_UNITS, reducedMotion),
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
  // onto the sky.
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
        scrollDistance,
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

  // The figure: a simple pivoting body — the ground pivot sits partway UP the
  // walkway (not at the viewer's own feet), so the character reads as a
  // small figure walking away down the road, with open asphalt in the
  // foreground — an establishing "at a distance" framing rather than filling
  // the frame. Hips/torso/head stack above the pivot, leaning by
  // `state.angle`. Rotation here is the CORE gameplay signal (not
  // decorative), so it is always drawn at the true angle, reduced-motion or
  // not — only the ambient scroll above (and, per its own comment below, the
  // leg swing) is dropped, per ADR §5 ("swap animation for instant state
  // change" applies to decorative motion, not to essential state feedback).
  const pivotX = RES / 2;
  const pivotY = RES * 0.72;
  const bodyH = RES * 0.22;
  const bodyW = RES * 0.065;

  // The fall flourish: once over, keep rotating past the fail angle toward
  // lying flat (~100°, a touch past horizontal), overshooting and rocking
  // back per `easeOutBack` — a little comedic "thud" rather than freezing
  // dead at whatever angle crossed the threshold. `state.angle` itself never
  // changes after `over` (frozen, per the engine contract); this is a purely
  // additive rendering rotation on top of it.
  let angleRad = (state.angle * Math.PI) / 180;
  if (state.over && fallProgress > 0) {
    const fallDir = state.angle >= 0 ? 1 : -1;
    const settledDeg = fallDir * 100;
    const eased = easeOutBack(Math.min(1, fallProgress));
    angleRad = ((state.angle + (settledDeg - state.angle) * eased) * Math.PI) / 180;
  }

  // A brief jolt on impact, decaying over the first half of the settle —
  // sells the "thud" alongside the rotation. Sine-driven (not random) to stay
  // a pure function of `fallProgress`.
  let shakeX = 0;
  if (state.over && fallProgress > 0 && fallProgress < 0.5) {
    shakeX = Math.sin(fallProgress * 60) * (1 - fallProgress / 0.5) * bodyW * 0.5;
  }

  const clothesColor = findClothesColor(character.clothesId);
  const shoeColor = findShoeColor(character.shoesId);
  const skinColor = findSkinTone(character.skinId);
  const hairColor = findHairColor(character.hairColorId);
  const figureTone = clothesColor.id === "classic" ? palette.figure : clothesColor.tone;
  const figureShade = clothesColor.id === "classic" ? palette.figureShade : clothesColor.shade;
  const shoeTone = shoeColor.tone;

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
  ctx.translate(pivotX + shakeX, pivotY);
  ctx.rotate(angleRad);

  const bodyTone = danger > 0.6 ? palette.danger : figureTone;

  // Legs, drawn first so the torso's hem overlaps their tops. Both anchor at the hip
  // line (`hipY`) and rotate as one rigid piece with the torso/head (they're drawn in
  // the same already-rotated local frame, not independently), so the whole figure reads
  // as one coherent leaning-while-walking body.
  if (reducedMotion) {
    // Neutral standing stance — no per-tick swing, consistent with freezing the
    // decorative scroll above under reduced motion.
    drawPlantedLeg(ctx, "left", hipY, hipHalf, legW, bodyTone, figureShade, shoeTone);
    drawPlantedLeg(ctx, "right", hipY, hipHalf, legW, bodyTone, figureShade, shoeTone);
  } else {
    drawPlantedLeg(ctx, plantedLeg, hipY, hipHalf, legW, bodyTone, figureShade, shoeTone);
    drawSwingingLeg(
      ctx,
      swingingLeg,
      hipY,
      hipHalf,
      legLen,
      legW,
      strideProgress,
      bodyTone,
      figureShade,
      shoeTone,
    );
  }

  // Torso: a vertical capsule with a gradient across its width for pseudo-3D
  // (cylindrical) shading, independent of the lean color-coding above. Tints
  // toward the danger color as the lean nears the fail threshold.
  const torsoGrad = ctx.createLinearGradient(-bodyW / 2, 0, bodyW / 2, 0);
  torsoGrad.addColorStop(0, figureShade);
  torsoGrad.addColorStop(0.5, bodyTone);
  torsoGrad.addColorStop(1, figureShade);
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
    figureShade,
    skinColor.tone,
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
    figureShade,
    skinColor.tone,
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
  headGrad.addColorStop(0, skinColor.tone);
  headGrad.addColorStop(1, skinColor.shade);
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  // Hair, then face, then beard, then accessory, then hat — drawn last, in
  // the same rotated frame, so they all lean with the head/body as one
  // piece. Hair under everything else so a hat/headphones band sits on top
  // of it; face under the beard so a full beard naturally covers the mouth;
  // accessory under the hat so a hat brim can still overlap it, matching how
  // a real hat would sit on top.
  const faceExpression: DrunkWalkFaceExpression =
    state.over && fallProgress > 0.3 ? "dizzy" : danger > 0.6 ? "worried" : "calm";
  drawHair(ctx, character.hair, headR, headY, hairColor.tone, hairColor.shade);
  drawFace(ctx, headR, headY, faceExpression);
  drawBeard(ctx, character.beard, headR, headY);
  drawAccessory(ctx, character.accessory, headR, headY);
  drawHat(ctx, character.hat, headR, headY, figureTone, figureShade);

  ctx.restore();

  // A comedic little flourish once the character has actually fallen: a
  // "thud" of dust puffs plus an "Oof!" near the landing spot, both driven
  // by the same `fallProgress` as the rotation above — ramps in fast, fades
  // out toward the end of the settle, entirely decorative.
  if (state.over && fallProgress > 0) {
    const burstIn = Math.min(1, fallProgress * 2.2);
    const fadeOut = 1 - Math.max(0, fallProgress - 0.6) / 0.4;
    const alpha = Math.max(0, Math.min(burstIn, fadeOut));
    if (alpha > 0) {
      const fallDir = state.angle >= 0 ? 1 : -1;
      const impactX = pivotX + fallDir * bodyH * 0.5;
      const impactY = pivotY - bodyW * 0.4;
      const rise = fallProgress * bodyH * 0.18;

      ctx.save();
      ctx.globalAlpha = alpha * 0.55;
      ctx.fillStyle = palette.ink;
      for (let i = 0; i < 3; i++) {
        const spread = (i - 1) * bodyW * 0.9;
        ctx.beginPath();
        ctx.ellipse(
          impactX + spread,
          impactY - rise,
          bodyW * (0.5 - i * 0.08),
          bodyW * 0.3,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = bodyTone;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.translate(impactX, impactY - bodyH * 0.32 - rise);
      ctx.rotate((-fallDir * 8 * Math.PI) / 180);
      ctx.font = `700 ${RES * 0.045}px system-ui, sans-serif`;
      ctx.fillText("Oof!", 0, 0);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = bodyTone;
      ctx.font = `${RES * 0.03}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✦", impactX - bodyW * 1.6, impactY - bodyH * 0.4 - rise);
      ctx.fillText("✦", impactX + bodyW * 1.4, impactY - bodyH * 0.55 - rise * 1.3);
      ctx.restore();
    }
  }

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
function resizeCanvasForDpr(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.round(RES * dpr);
  const targetH = Math.round(RES * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export interface DrunkWalkSceneProps extends RealtimeSceneProps<DrunkWalkState> {
  /** The player's chosen character (MPG-076 customization). Defaults to the
   * plain classic look for any caller that doesn't wire one up. */
  character?: DrunkWalkCharacter;
}

export function DrunkWalkScene({
  state,
  score,
  reducedMotion,
  character = DEFAULT_DRUNK_WALK_CHARACTER,
}: DrunkWalkSceneProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    // No 2D context (e.g. jsdom) → no-op; the screen's accessible state stands
    // on its own, so the game still "runs", it just isn't painted.
    if (!canvas || !ctx) return;
    resizeCanvasForDpr(canvas, ctx);
    draw(ctx, state, score, reducedMotion, readPalette(canvas), character, 0);
  }, [state, score, reducedMotion, character]);

  // The fall-and-settle flourish: a short, self-contained rAF loop scoped to
  // just this one decorative sequence — NOT a general clock driving the
  // scene (everything else above stays a pure snapshot of `DrunkWalkState`,
  // per the header doc). Starts the instant `state.over` flips true and runs
  // for `FALL_SETTLE_MS`, redrawing directly; skipped entirely under reduced
  // motion, so the character just freezes at the raw fail angle (same as
  // before this feature existed) — "essential state stays, decorative motion
  // drops", the same treatment already applied to the rung-scroll/gait above.
  // Keyed only on `state.over` (not `state`/`score`, which are frozen once
  // `over` anyway) so it doesn't re-fire on every tick while still running.
  useEffect(() => {
    if (!state.over || reducedMotion) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let raf = 0;
    const startedAt = performance.now();
    const palette = readPalette(canvas);
    const step = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / FALL_SETTLE_MS);
      draw(ctx, state, score, reducedMotion, palette, character, progress);
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [state.over, reducedMotion, character]);

  return (
    <canvas ref={canvasRef} width={RES} height={RES} className={styles.canvas} aria-hidden="true" />
  );
}
