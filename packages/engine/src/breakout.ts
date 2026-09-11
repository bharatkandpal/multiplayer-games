// Breakout (MPG-075) — a solo real-time arcade game implementing the pure
// RealtimeModule<S, I> contract (ADR 0002). Slide the paddle to bounce the ball
// into a wall of bricks; each brick cleared scores points. Lose the ball off the
// bottom and you lose a life; run out of lives and the run ends. Clear the wall
// and a fresh, slightly faster wall drops in — so it's endless and score-chasing
// (contrast Floppy Birds' discrete flap: this is continuous paddle + ball
// physics, MPG-075's reason to exist).
//
// The paddle is POSITION-controlled (MPG-121): each tick's input names the
// target paddle centre as a 0..1 fraction of the playfield width, and the paddle
// snaps there. A mouse/finger hovers the paddle to exactly where you point it;
// keyboard parity feeds the same fraction, integrated at a fixed step per tick by
// the web input source. (This replaced the old left/right nudge + coast model,
// which lagged behind the pointer.)
//
// PURE, exactly like the other realtime modules: no clock, no rAF, no
// Math.random. The only randomness is the ball's launch angle, drawn from the
// seeded PRNG carried in state (see ./prng); every bounce is deterministic
// geometry. A run is therefore a deterministic function of (seed, input log) —
// replayable server-side to validate a submitted score (MPG-065). The rAF loop,
// wall-clock pacing, input sampling and rendering all live in the web
// controller/renderer.

import { nextFloat, seedPrng, type PrngState } from "./prng";
import type { RealtimeModule } from "./realtime";

/**
 * Per-tick input: the target paddle centre as a fraction of the playfield width
 * (`0` = left wall, `1` = right wall), or `null` to hold position this tick. A
 * fraction (not world units) keeps the input modality-neutral — pointer and
 * keyboard both produce the same 0..1 axis, so both replay identically.
 */
export interface BreakoutInput {
  readonly targetX: number | null;
}

export interface BreakoutState {
  readonly paddleX: number; // center x of the paddle
  readonly ballX: number;
  readonly ballY: number;
  readonly ballVX: number;
  readonly ballVY: number;
  readonly ballSpeed: number; // magnitude of ball velocity (rises per cleared wall)
  /** Row-major brick grid; `1` = present, `0` = cleared. Index `r * cols + c`. */
  readonly bricks: readonly number[];
  readonly lives: number;
  readonly level: number; // cleared-wall count; drives the difficulty ramp
  readonly score: number;
  readonly over: boolean;
  readonly rng: PrngState;
}

/**
 * World constants in abstract "world units" (the renderer maps these to canvas
 * pixels). The playfield is WIDTHxHEIGHT with the bottom open (a ball off the
 * bottom costs a life).
 */
export const BREAKOUT_WORLD = {
  width: 100,
  height: 100,
  paddleY: 92,
  paddleWidth: 16,
  paddleHeight: 2.5,
  ballRadius: 1.4,
  baseBallSpeed: 1.05, // per tick, level 0
  ballSpeedRampPerLevel: 0.08, // added to speed per cleared wall
  /** Fraction of the ball's speed the seeded launch lean can steer horizontally. */
  paddleSteer: 0.85,
  /**
   * Convex-paddle reflection: the curved face fans the ball out by up to this
   * many degrees from vertical at the paddle's edges (centre → straight up).
   * This is the "true physics of reflection" a convex bar gives — the outgoing
   * angle tracks the surface normal at the hit point, not a flat linear steer.
   */
  maxBounceDeg: 60,
  cols: 8,
  rows: 5,
  brickMarginX: 4,
  brickTop: 12,
  brickHeight: 4,
  brickGap: 1,
  lives: 3,
  pointsPerBrick: 10,
} as const;

const TICK_HZ = 60;
const HALF_PADDLE = BREAKOUT_WORLD.paddleWidth / 2;
const BRICK_WIDTH = (BREAKOUT_WORLD.width - 2 * BREAKOUT_WORLD.brickMarginX) / BREAKOUT_WORLD.cols;
const MAX_BOUNCE_ANGLE = (BREAKOUT_WORLD.maxBounceDeg * Math.PI) / 180;

/** The x/y bounds of brick cell `index` (row-major). Pure geometry. */
export function brickRect(index: number): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const r = Math.floor(index / BREAKOUT_WORLD.cols);
  const c = index % BREAKOUT_WORLD.cols;
  const x0 = BREAKOUT_WORLD.brickMarginX + c * BRICK_WIDTH;
  const y0 = BREAKOUT_WORLD.brickTop + r * (BREAKOUT_WORLD.brickHeight + BREAKOUT_WORLD.brickGap);
  return { x0, y0, x1: x0 + BRICK_WIDTH, y1: y0 + BREAKOUT_WORLD.brickHeight };
}

/** A fresh, full wall of bricks. */
function fullWall(): number[] {
  return new Array(BREAKOUT_WORLD.cols * BREAKOUT_WORLD.rows).fill(1);
}

/** The ball speed at a given cleared-wall count. */
function speedForLevel(level: number): number {
  return BREAKOUT_WORLD.baseBallSpeed + level * BREAKOUT_WORLD.ballSpeedRampPerLevel;
}

/** Clamps the paddle centre to keep the whole paddle inside the walls. */
function clampPaddle(x: number): number {
  return Math.max(HALF_PADDLE, Math.min(BREAKOUT_WORLD.width - HALF_PADDLE, x));
}

/**
 * Places the ball just above the paddle and launches it upward at `speed`, with
 * a seeded left/right lean so no two lives start identically. Pure: advances the
 * RNG. Used at run start and after every lost life.
 */
function launchBall(
  paddleX: number,
  speed: number,
  rng: PrngState,
): { ballX: number; ballY: number; ballVX: number; ballVY: number; rng: PrngState } {
  const { value, next } = nextFloat(rng);
  // Steer between -paddleSteer..+paddleSteer of the speed, always upward.
  const vx = (value * 2 - 1) * BREAKOUT_WORLD.paddleSteer * speed;
  const vy = -Math.sqrt(Math.max(speed * speed - vx * vx, 0.0001));
  return {
    ballX: paddleX,
    ballY: BREAKOUT_WORLD.paddleY - BREAKOUT_WORLD.ballRadius - 0.5,
    ballVX: vx,
    ballVY: vy,
    rng: next,
  };
}

/**
 * Reflects the ball off the CONVEX paddle. The hit offset `t` in `[-1, 1]` (where
 * on the face the ball struck) becomes an outgoing angle from vertical, so the
 * centre sends the ball straight up and the edges fan it out by up to
 * `maxBounceDeg`. Speed magnitude is preserved. This is the curved-face physics —
 * the outgoing direction follows the paddle's surface normal at the hit point.
 */
export function bounceOffPaddle(
  ballX: number,
  paddleX: number,
  speed: number,
): { vx: number; vy: number } {
  const t = Math.max(-1, Math.min(1, (ballX - paddleX) / HALF_PADDLE));
  const angle = t * MAX_BOUNCE_ANGLE;
  return { vx: speed * Math.sin(angle), vy: -speed * Math.cos(angle) };
}

export const breakout: RealtimeModule<BreakoutState, BreakoutInput> = {
  id: "breakout",
  kind: "realtime",
  tickHz: TICK_HZ,

  createInitialState(seed: number): BreakoutState {
    const paddleX = BREAKOUT_WORLD.width / 2;
    const speed = speedForLevel(0);
    const launched = launchBall(paddleX, speed, seedPrng(seed));
    return {
      paddleX,
      ballX: launched.ballX,
      ballY: launched.ballY,
      ballVX: launched.ballVX,
      ballVY: launched.ballVY,
      ballSpeed: speed,
      bricks: fullWall(),
      lives: BREAKOUT_WORLD.lives,
      level: 0,
      score: 0,
      over: false,
      rng: launched.rng,
    };
  },

  tick(state: BreakoutState, input: BreakoutInput): BreakoutState {
    // Once over, the run is frozen — ticks are a no-op (score is final).
    if (state.over) return state;

    // Paddle: position control. A target (0..1 fraction of the width) snaps the
    // paddle centre there this tick; `null` holds the current position. Direct,
    // so the paddle sits exactly where the pointer/keys point — no momentum lag.
    const paddleX =
      input.targetX === null ? state.paddleX : clampPaddle(input.targetX * BREAKOUT_WORLD.width);

    const r = BREAKOUT_WORLD.ballRadius;
    const prevY = state.ballY;
    let ballX = state.ballX + state.ballVX;
    let ballY = state.ballY + state.ballVY;
    let ballVX = state.ballVX;
    let ballVY = state.ballVY;

    // Side and top walls (the bottom is open — that's how you lose a life).
    if (ballX < r) {
      ballX = r;
      ballVX = -ballVX;
    } else if (ballX > BREAKOUT_WORLD.width - r) {
      ballX = BREAKOUT_WORLD.width - r;
      ballVX = -ballVX;
    }
    if (ballY < r) {
      ballY = r;
      ballVY = -ballVY;
    }

    // Paddle: reflect only when descending across the paddle's top edge and
    // within its horizontal span (plus the ball radius), steering by hit point.
    const paddleTop = BREAKOUT_WORLD.paddleY;
    if (
      ballVY > 0 &&
      ballY + r >= paddleTop &&
      prevY + r <= paddleTop + BREAKOUT_WORLD.paddleHeight &&
      ballX >= paddleX - HALF_PADDLE - r &&
      ballX <= paddleX + HALF_PADDLE + r
    ) {
      const bounced = bounceOffPaddle(ballX, paddleX, state.ballSpeed);
      ballVX = bounced.vx;
      ballVY = bounced.vy;
      ballY = paddleTop - r;
    }

    // Brick collision: at most one brick per tick (two in a single tick is
    // vanishingly rare at these speeds). Reflect off whichever axis the ball
    // entered from, inferred by comparing its pre-move position to the cell.
    const bricks = state.bricks.slice();
    let score = state.score;
    for (let i = 0; i < bricks.length; i += 1) {
      if (bricks[i] === 0) continue;
      const { x0, y0, x1, y1 } = brickRect(i);
      const hit = ballX + r > x0 && ballX - r < x1 && ballY + r > y0 && ballY - r < y1;
      if (!hit) continue;

      bricks[i] = 0;
      score += BREAKOUT_WORLD.pointsPerBrick;
      const prevX = state.ballX;
      const cameFromSide = prevX + r <= x0 || prevX - r >= x1;
      const cameFromVertical = prevY + r <= y0 || prevY - r >= y1;
      if (cameFromSide && !cameFromVertical) ballVX = -ballVX;
      else ballVY = -ballVY;
      break;
    }

    // Cleared the wall? Drop a fresh, faster one and keep the ball in play.
    let nextBricks = bricks;
    let level = state.level;
    let ballSpeed = state.ballSpeed;
    if (bricks.every((b) => b === 0)) {
      level += 1;
      ballSpeed = speedForLevel(level);
      nextBricks = fullWall();
      // Rescale the current velocity to the new (faster) speed, preserving
      // direction, so the ball speeds up without teleporting.
      const mag = Math.hypot(ballVX, ballVY) || 1;
      ballVX = (ballVX / mag) * ballSpeed;
      ballVY = (ballVY / mag) * ballSpeed;
    }

    // Lost the ball off the bottom.
    let lives = state.lives;
    let over = false; // the early guard above already returned if state.over
    let rng = state.rng;
    if (ballY - r > BREAKOUT_WORLD.height) {
      lives -= 1;
      if (lives <= 0) {
        over = true;
      } else {
        const relaunch = launchBall(paddleX, ballSpeed, rng);
        ballX = relaunch.ballX;
        ballY = relaunch.ballY;
        ballVX = relaunch.ballVX;
        ballVY = relaunch.ballVY;
        rng = relaunch.rng;
      }
    }

    return {
      paddleX,
      ballX,
      ballY,
      ballVX,
      ballVY,
      ballSpeed,
      bricks: nextBricks,
      lives,
      level,
      score,
      over,
      rng,
    };
  },

  getScore(state: BreakoutState): number {
    return state.score;
  },

  isGameOver(state: BreakoutState): boolean {
    return state.over;
  },
};
