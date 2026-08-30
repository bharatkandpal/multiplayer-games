// Drunk Walk (MPG-076) — a solo real-time arcade game implementing the pure
// RealtimeModule<S, I> contract (ADR 0002), sibling to floppy-birds. Inverted-pendulum
// balance: the character leans away from vertical under a constant destabilizing
// "gravity", and the player taps the LEFT or RIGHT half of the screen each tick to
// nudge it back. Score is distance walked, which accumulates every tick the character
// stays upright and freezes the instant it falls.
//
// PURE, exactly like floppy-birds: no clock, no rAF, no Math.random. The only
// randomness (the starting lean offset) derives from the seed and is carried in state
// via the PRNG (see ./prng). The rAF loop, wall-clock pacing, input sampling and
// rendering all live in the web controller/renderer. Given a seed + a per-tick input
// sequence, a run is fully deterministic and replayable (this is load-bearing for
// MPG-065's server-side re-simulation anti-cheat, same as floppy-birds).

import { nextFloat, seedPrng, type PrngState } from "./prng";
import type { RealtimeModule } from "./realtime";

/**
 * Per-tick input: which half of the screen (if any) was tapped this tick. `null` means
 * no tap this tick. Tapping the side OPPOSITE the current lean corrects toward vertical;
 * tapping the SAME side as the lean is a misread/misclick and actively accelerates the
 * fall — this is intentional skill-based design, not a bug.
 */
export interface DrunkWalkInput {
  readonly tap: "left" | "right" | null;
}

/** Which leg is planted/stance. See `DrunkWalkState.steppingLeg` and `tick()` for the
 * gait/sway direction convention. */
export type SteppingLeg = "left" | "right";

export interface DrunkWalkState {
  /** Signed lean from vertical, in degrees. Negative = leaning left, positive = right. */
  readonly angle: number;
  /** Distance walked so far (the score). Frozen once `over`. */
  readonly distance: number;
  /** Whether the character has fallen — the run is frozen once true. */
  readonly over: boolean;
  readonly rng: PrngState;
  /** Ticks since start. Also drives step cadence (see `WORLD.stepIntervalTicks`); the
   * frontend can derive stride phase from `t % stepIntervalTicks` without extra state. */
  readonly t: number;
  /** Which leg is currently planted/stance. Flips every `stepIntervalTicks` ticks — see
   * `tick()` for the direction convention (lifting a leg sways the body the OTHER way). */
  readonly steppingLeg: SteppingLeg;
}

/**
 * World constants, in degrees and "distance units per tick". Design choices baked in
 * here (see tick() below for the per-tick model they drive):
 *  - `failAngleDeg` picked at the middle of the product's 45-60° ballpark.
 *  - `gravityK` is a *linear* self-reinforcing coefficient (`delta = gravityK * angle`):
 *    the further you lean, the faster you lean further, which — because it compounds
 *    tick over tick — produces the escalating "harder the deeper you're in" curve the
 *    spec asks for without needing a full second-order (velocity/momentum) pendulum
 *    model. This is deliberately game-y, not a physically exact inverted pendulum.
 *  - `correctTapMaxDeg` is the corrective impulse AT angle=0 (strongest); it falls off
 *    *linearly* to 0 as |angle| approaches `failAngleDeg` (weakest), per spec: recovery
 *    from a deep lean should be hard, correcting a slight wobble should be cheap. This
 *    is intentionally counter to a real pendulum (where restoring torque isn't capped
 *    like this) — it's a designed difficulty curve, not physics.
 *  - `wrongTapPunishDeg` is a flat (non-scaled) penalty added in the falling direction
 *    when the player taps the same side as the lean — wrong taps always hurt, and are
 *    not softened near vertical, so misreads are punished consistently.
 */
export const WORLD = {
  failAngleDeg: 50,
  startAngleMaxDeg: 5,
  gravityK: 0.015,
  correctTapMaxDeg: 3.5,
  wrongTapPunishDeg: 1.5,
  /** Forward distance gained per tick while alive. Kept constant (not scaled by how
   * "steady" the lean is): the fall risk already punishes instability via gravity/wrong
   * taps, so also throttling speed by wobble would double-penalize the same mistake.
   * A constant pace keeps score a clean, predictable function of survival distance. */
  forwardSpeedPerTick: 1,
  /** Ticks between steps. At `tickHz: 60`, 20 ticks = 0.333s per step — a brisk, lively
   * cadence (tuned faster than a naturalistic amble on purpose, per playtest feedback
   * that the original 0.6s/step pace felt sluggish), while still comfortably inside
   * "walkable" territory: even at this cadence, a `correctTapMaxDeg` tap near vertical
   * (3.5°) plus gravity pull between steps still outweighs a single step's sway impulse
   * (10-15°) over a couple of ticks, so the balance challenge gets harder/more frequent
   * without becoming un-recoverable. A step fires when `t % 20 === 0` (t counts ticks
   * elapsed, starting at the first tick after spawn), so the very first step lands at
   * t=20, not t=0 — the character doesn't step before it's taken a tick. */
  stepIntervalTicks: 20,
  /** Uniform sway magnitude range (degrees) applied as a one-time impulse on a step
   * tick, per spec. */
  stepSwayMinDeg: 10,
  stepSwayMaxDeg: 15,
} as const;

const TICK_HZ = 60;

/**
 * The signed per-tick angle delta from a tap, given the current lean. Returns 0 for no
 * tap, or when perfectly vertical (no lean direction to be "same side" or "opposite" of).
 */
function tapDelta(angle: number, tap: DrunkWalkInput["tap"]): number {
  if (tap === null || angle === 0) return 0;
  const leaningRight = angle > 0;
  const tappedRight = tap === "right";
  const sameSide = leaningRight === tappedRight;
  const sign = leaningRight ? 1 : -1;

  if (sameSide) {
    // Wrong-side tap: accelerates the fall (adds force in the falling direction).
    return sign * WORLD.wrongTapPunishDeg;
  }

  // Corrective tap: strongest near vertical, linearly weaker as |angle| approaches the
  // fail threshold (floored at 0 so it never overshoots into a boost past the threshold).
  const strength = Math.max(0, WORLD.correctTapMaxDeg * (1 - Math.abs(angle) / WORLD.failAngleDeg));
  return -sign * strength;
}

export const drunkWalk: RealtimeModule<DrunkWalkState, DrunkWalkInput> = {
  id: "drunk-walk",
  kind: "realtime",
  tickHz: TICK_HZ,

  createInitialState(seed: number): DrunkWalkState {
    const rng0 = seedPrng(seed);
    const { value, next } = nextFloat(rng0);
    // Uniform offset in (-startAngleMaxDeg, +startAngleMaxDeg); a continuous draw is
    // ~never exactly 0, satisfying "never spawns perfectly upright" without special-casing.
    const angle = (value * 2 - 1) * WORLD.startAngleMaxDeg;
    // Starting stance is arbitrary (not seed-derived) — always begins planted on the
    // left leg for simplicity/predictability; the first step (lifting that left leg,
    // per the gait convention below) fires at t = stepIntervalTicks and flips stance to right.
    return { angle, distance: 0, over: false, rng: next, t: 0, steppingLeg: "left" };
  },

  tick(state: DrunkWalkState, input: DrunkWalkInput): DrunkWalkState {
    // Once fallen, the run is frozen — ticks are a no-op (score is final), including
    // the gait: stepping stops the instant the character falls.
    if (state.over) return state;

    const t = state.t + 1;
    // Gravity: a self-reinforcing linear pull away from vertical (see WORLD.gravityK doc).
    const gravityDelta = WORLD.gravityK * state.angle;

    const isStepTick = t % WORLD.stepIntervalTicks === 0;
    let rng = state.rng;
    let stepDelta = 0;
    let steppingLeg = state.steppingLeg;
    if (isStepTick) {
      // Lifting a leg shifts weight onto the OTHER (planted) leg — real gait intuition,
      // and the opposite of what might seem naively intuitive: lifting the LEFT leg
      // sways the body toward the RIGHT (positive angle), lifting the RIGHT leg sways
      // LEFT (negative). `state.steppingLeg` is the leg about to be lifted (the one
      // currently planted from the *previous* step); after the step it flips to record
      // the new stance.
      const liftingLeg = state.steppingLeg;
      const draw = nextFloat(rng);
      rng = draw.next;
      const magnitude =
        WORLD.stepSwayMinDeg + draw.value * (WORLD.stepSwayMaxDeg - WORLD.stepSwayMinDeg);
      stepDelta = liftingLeg === "left" ? magnitude : -magnitude;
      steppingLeg = liftingLeg === "left" ? "right" : "left";
    }

    const angle = state.angle + gravityDelta + tapDelta(state.angle, input.tap) + stepDelta;

    const over = Math.abs(angle) >= WORLD.failAngleDeg;
    // Distance accumulates only while still upright at the end of this tick; it stops
    // the instant the fail threshold is crossed, then stays frozen (freeze-on-over).
    const distance = over ? state.distance : state.distance + WORLD.forwardSpeedPerTick;

    return { angle, distance, over, rng, t, steppingLeg };
  },

  getScore(state: DrunkWalkState): number {
    return state.distance;
  },

  isGameOver(state: DrunkWalkState): boolean {
    return state.over;
  },
};
