import { describe, it, expect } from "vitest";
import { drunkWalk, WORLD, type DrunkWalkInput, type DrunkWalkState } from "./drunk-walk";
import { clearRealtimeRegistry, getRealtimeGame, listRealtimeGames } from "./realtime-registry";
import { registerBuiltInRealtimeGames } from "./realtime-games";

const NO_TAP: DrunkWalkInput = { tap: null };
const TAP_LEFT: DrunkWalkInput = { tap: "left" };
const TAP_RIGHT: DrunkWalkInput = { tap: "right" };

/** Runs a scripted input sequence from a seed, returning every state (inclusive of start). */
function run(seed: number, inputs: readonly DrunkWalkInput[]): DrunkWalkState[] {
  const states: DrunkWalkState[] = [drunkWalk.createInitialState(seed)];
  for (const input of inputs) {
    states.push(drunkWalk.tick(states[states.length - 1]!, input));
  }
  return states;
}

/** The tick index at which the run first ended, or -1 if it never did. */
function gameOverTick(states: readonly DrunkWalkState[]): number {
  return states.findIndex((s) => s.over);
}

describe("drunkWalk module", () => {
  it("exposes a valid RealtimeModule shape", () => {
    expect(drunkWalk.id).toBe("drunk-walk");
    expect(drunkWalk.kind).toBe("realtime");
    expect(drunkWalk.tickHz).toBeGreaterThan(0);
  });

  it("registers as a built-in realtime game", () => {
    clearRealtimeRegistry();
    registerBuiltInRealtimeGames();
    expect(listRealtimeGames()).toContain("drunk-walk");
    expect(getRealtimeGame("drunk-walk")).toBe(drunkWalk);
  });

  it("starts alive, within ±5° of vertical, with score 0", () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const s0 = drunkWalk.createInitialState(seed);
      expect(s0.over).toBe(false);
      expect(drunkWalk.isGameOver(s0)).toBe(false);
      expect(drunkWalk.getScore(s0)).toBe(0);
      expect(Math.abs(s0.angle)).toBeLessThanOrEqual(WORLD.startAngleMaxDeg);
      expect(s0.angle).not.toBe(0); // never spawns perfectly upright
    }
  });

  it("diverges on a different seed (randomness derives from the seed)", () => {
    const angleA = drunkWalk.createInitialState(1).angle;
    const angleB = drunkWalk.createInitialState(2).angle;
    expect(angleA).not.toBe(angleB);
  });

  it("is deterministic: same seed + same inputs → identical run (no timers/DOM)", () => {
    const inputs = Array.from({ length: 200 }, (_, i): DrunkWalkInput => {
      if (i % 3 === 0) return TAP_LEFT;
      if (i % 5 === 0) return TAP_RIGHT;
      return NO_TAP;
    });
    const a = run(42, inputs);
    const b = run(42, inputs);
    expect(a).toEqual(b);
    const last = a[a.length - 1]!;
    expect(drunkWalk.getScore(last)).toBe(drunkWalk.getScore(b[b.length - 1]!));
    expect(drunkWalk.isGameOver(last)).toBe(drunkWalk.isGameOver(b[b.length - 1]!));
  });

  it("gravity alone grows |angle| further from vertical", () => {
    const state: DrunkWalkState = {
      angle: 10,
      distance: 0,
      over: false,
      rng: { s: 1 },
      steppingLeg: "left",
      t: 0,
    };
    const next = drunkWalk.tick(state, NO_TAP);
    expect(Math.abs(next.angle)).toBeGreaterThan(Math.abs(state.angle));
  });

  it("a corrective tap (opposite side of lean) reduces |angle| relative to gravity alone", () => {
    const leaningRight: DrunkWalkState = {
      angle: 10,
      distance: 0,
      over: false,
      rng: { s: 1 },
      steppingLeg: "left",
      t: 0,
    };
    const withGravityOnly = drunkWalk.tick(leaningRight, NO_TAP);
    const withCorrection = drunkWalk.tick(leaningRight, TAP_LEFT);
    expect(withCorrection.angle).toBeLessThan(withGravityOnly.angle);
    expect(Math.abs(withCorrection.angle)).toBeLessThan(Math.abs(leaningRight.angle));
  });

  it("a wrong-side tap (same side as lean) accelerates the fall vs. gravity alone", () => {
    const leaningRight: DrunkWalkState = {
      angle: 10,
      distance: 0,
      over: false,
      rng: { s: 1 },
      steppingLeg: "left",
      t: 0,
    };
    const withGravityOnly = drunkWalk.tick(leaningRight, NO_TAP);
    const withWrongTap = drunkWalk.tick(leaningRight, TAP_RIGHT);
    expect(withWrongTap.angle).toBeGreaterThan(withGravityOnly.angle);
  });

  it("corrective force magnitude decreases as |angle| grows (weaker near the threshold)", () => {
    const near0: DrunkWalkState = {
      angle: 5,
      distance: 0,
      over: false,
      rng: { s: 1 },
      steppingLeg: "left",
      t: 0,
    };
    const nearFail: DrunkWalkState = {
      angle: WORLD.failAngleDeg - 5,
      distance: 0,
      over: false,
      rng: { s: 1 },
      steppingLeg: "left",
      t: 0,
    };
    // Correction for near0 is a left tap (leaning right); same for nearFail.
    const correctedNear0 = drunkWalk.tick(near0, TAP_LEFT);
    const correctedNearFail = drunkWalk.tick(nearFail, TAP_LEFT);
    const correctionMagnitudeNear0 = Math.abs(near0.angle - correctedNear0.angle);
    const correctionMagnitudeNearFail = Math.abs(nearFail.angle - correctedNearFail.angle);
    expect(correctionMagnitudeNear0).toBeGreaterThan(correctionMagnitudeNearFail);
  });

  it("falls once |angle| crosses the fail threshold", () => {
    const state: DrunkWalkState = {
      angle: WORLD.failAngleDeg - 0.01,
      distance: 20,
      over: false,
      rng: { s: 1 },
      steppingLeg: "left",
      t: 0,
    };
    // Wrong-side tap pushes it over the edge.
    const next = drunkWalk.tick(state, TAP_RIGHT);
    expect(next.over).toBe(true);
    expect(drunkWalk.isGameOver(next)).toBe(true);
    expect(Math.abs(next.angle)).toBeGreaterThanOrEqual(WORLD.failAngleDeg);
  });

  it("with no taps the walker eventually falls from a starting lean", () => {
    const states = run(
      7,
      Array.from({ length: 500 }, () => NO_TAP),
    );
    const overAt = gameOverTick(states);
    expect(overAt).toBeGreaterThan(0);
  });

  it("is a no-op once over: ticking a finished run returns the same state", () => {
    const over: DrunkWalkState = {
      angle: 55,
      distance: 42,
      over: true,
      rng: { s: 1 },
      steppingLeg: "left",
      t: 10,
    };
    expect(drunkWalk.tick(over, TAP_LEFT)).toBe(over);
  });

  it("score (distance) increases each tick while alive and freezes after the fall", () => {
    const states = run(
      3,
      Array.from({ length: 500 }, () => NO_TAP),
    );
    const overAt = gameOverTick(states);
    expect(overAt).toBeGreaterThan(0);
    // Strictly increasing up to (not including) the fall.
    for (let i = 1; i < overAt; i++) {
      expect(drunkWalk.getScore(states[i]!)).toBeGreaterThan(drunkWalk.getScore(states[i - 1]!));
    }
    // Frozen after the fall.
    const finalScore = drunkWalk.getScore(states[overAt]!);
    for (let i = overAt; i < states.length; i++) {
      expect(drunkWalk.getScore(states[i]!)).toBe(finalScore);
    }
  });

  it("does not mutate the input state (pure tick)", () => {
    const s0 = drunkWalk.createInitialState(3);
    const snapshot = JSON.parse(JSON.stringify(s0)) as DrunkWalkState;
    drunkWalk.tick(s0, TAP_LEFT);
    expect(s0).toEqual(snapshot);
  });

  describe("walking gait (stepping)", () => {
    it("starts planted on the left leg", () => {
      const s0 = drunkWalk.createInitialState(1);
      expect(s0.steppingLeg).toBe("left");
    });

    it("fires a step exactly every stepIntervalTicks, and only then", () => {
      // Re-level angle to 0 before each tick so the run never falls mid-test (falling
      // would freeze stepping and break the cadence assertion below) — cadence/direction
      // are what's under test here, not survivability.
      let state = drunkWalk.createInitialState(11);
      const flipTicks: number[] = [];
      let prevLeg = state.steppingLeg;
      for (let i = 0; i < WORLD.stepIntervalTicks * 4; i++) {
        state = drunkWalk.tick({ ...state, angle: 0 }, NO_TAP);
        if (state.steppingLeg !== prevLeg) {
          flipTicks.push(state.t);
          prevLeg = state.steppingLeg;
        }
      }
      expect(flipTicks).toEqual([
        WORLD.stepIntervalTicks,
        WORLD.stepIntervalTicks * 2,
        WORLD.stepIntervalTicks * 3,
        WORLD.stepIntervalTicks * 4,
      ]);
    });

    it("alternates steppingLeg left/right/left/right over successive steps", () => {
      let state = drunkWalk.createInitialState(5);
      expect(state.steppingLeg).toBe("left");
      const legsAfterEachStep: Array<"left" | "right"> = [];
      for (let i = 0; i < WORLD.stepIntervalTicks * 5; i++) {
        // Re-level each tick so the run survives long enough to observe all 5 steps.
        state = drunkWalk.tick({ ...state, angle: 0 }, NO_TAP);
        if (state.t % WORLD.stepIntervalTicks === 0 && !state.over) {
          legsAfterEachStep.push(state.steppingLeg);
        }
      }
      expect(legsAfterEachStep).toEqual(["right", "left", "right", "left", "right"]);
    });

    it("a step perturbs angle by a magnitude in [10, 15] degrees, direction matching the leg that just lifted", () => {
      // Start perfectly level (bypass the seeded starting lean) so the step impulse is
      // isolated and its full magnitude/sign is directly observable.
      const level: DrunkWalkState = {
        angle: 0,
        distance: 0,
        over: false,
        rng: { s: 123 },
        t: WORLD.stepIntervalTicks - 1,
        steppingLeg: "left",
      };
      const stepped = drunkWalk.tick(level, NO_TAP);
      // Gravity contributes 0 at angle 0, so the entire delta is the step impulse.
      // Lifting the LEFT leg (the planted leg going into this step) sways RIGHT (positive).
      expect(stepped.angle).toBeGreaterThanOrEqual(WORLD.stepSwayMinDeg);
      expect(stepped.angle).toBeLessThanOrEqual(WORLD.stepSwayMaxDeg);
      expect(stepped.steppingLeg).toBe("right");

      const level2: DrunkWalkState = {
        angle: 0,
        distance: 0,
        over: false,
        rng: { s: 123 },
        t: WORLD.stepIntervalTicks - 1,
        steppingLeg: "right",
      };
      const stepped2 = drunkWalk.tick(level2, NO_TAP);
      // Lifting the RIGHT leg sways LEFT (negative).
      expect(stepped2.angle).toBeLessThanOrEqual(-WORLD.stepSwayMinDeg);
      expect(stepped2.angle).toBeGreaterThanOrEqual(-WORLD.stepSwayMaxDeg);
      expect(stepped2.steppingLeg).toBe("left");
    });

    it("sway magnitude stays within [10, 15] across many step draws", () => {
      let state = drunkWalk.createInitialState(999);
      // Force level angle so each step's isolated magnitude is directly readable, by
      // re-leveling between steps (gravity/no-tap drift is negligible over one tick but
      // we zero it explicitly for a clean read).
      for (let i = 0; i < 50; i++) {
        state = { ...state, angle: 0 };
        const before = state;
        state = drunkWalk.tick(state, NO_TAP);
        const isStepTick = state.t % WORLD.stepIntervalTicks === 0;
        if (isStepTick && !state.over) {
          expect(Math.abs(state.angle - before.angle)).toBeGreaterThanOrEqual(WORLD.stepSwayMinDeg);
          expect(Math.abs(state.angle - before.angle)).toBeLessThanOrEqual(WORLD.stepSwayMaxDeg);
        }
      }
    });

    it("stops stepping once the run is over (frozen, including steppingLeg)", () => {
      const overState: DrunkWalkState = {
        angle: 55,
        distance: 42,
        over: true,
        rng: { s: 1 },
        t: WORLD.stepIntervalTicks - 1,
        steppingLeg: "right",
      };
      const next = drunkWalk.tick(overState, NO_TAP);
      expect(next).toBe(overState);
      expect(next.steppingLeg).toBe("right");
    });
  });
});
