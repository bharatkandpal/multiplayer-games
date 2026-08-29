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
  ground: string;
  groundFar: string;
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
    ground: v("--color-text-muted", "#3a3f4a"),
    groundFar: v("--color-bg-inset", "#0b1020"),
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

function draw(
  ctx: CanvasRenderingContext2D,
  state: DrunkWalkState,
  score: number,
  reducedMotion: boolean,
  palette: Palette,
): void {
  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
  sky.addColorStop(0, palette.skyDeep);
  sky.addColorStop(1, palette.sky);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, RES, HORIZON_Y);

  // Ground plane: a foreshortened trapezoid receding to a vanishing point on
  // the horizon, shaded lighter near the viewer for a cheap depth cue.
  const ground = ctx.createLinearGradient(0, HORIZON_Y, 0, RES);
  ground.addColorStop(0, palette.groundFar);
  ground.addColorStop(1, palette.ground);
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.moveTo(RES / 2 - GROUND_TOP_HALF_WIDTH, HORIZON_Y);
  ctx.lineTo(RES / 2 + GROUND_TOP_HALF_WIDTH, HORIZON_Y);
  ctx.lineTo(RES / 2 + GROUND_BOTTOM_HALF_WIDTH, RES);
  ctx.lineTo(RES / 2 - GROUND_BOTTOM_HALF_WIDTH, RES);
  ctx.closePath();
  ctx.fill();

  // Perspective "rungs" scrolling toward the viewer as distance increases —
  // sells forward motion (endless-runner framing). Purely decorative, so
  // frozen under reduced motion (no non-essential motion, ADR §5) — the score
  // readout already carries distance as text.
  const RUNG_COUNT = 7;
  const SPACING_UNITS = 6; // world "distance" per rung, tuned to a readable cadence
  const scrollOffset = reducedMotion ? 0 : state.distance % SPACING_UNITS;
  ctx.strokeStyle = palette.rung;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < RUNG_COUNT; i++) {
    const depth = (i + 1 - scrollOffset / SPACING_UNITS) / RUNG_COUNT;
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
