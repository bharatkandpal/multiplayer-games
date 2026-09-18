import { describe, expect, it } from "vitest";
import {
  lumberjack,
  LUMBERJACK,
  drainPerTick,
  timeLeftFraction,
  incomingBranch,
  type Branch,
  type LumberjackInput,
  type LumberjackState,
  type Side,
} from "./lumberjack";

const IDLE: LumberjackInput = { chop: null };

/** Runs `n` ticks with no input. */
function idle(state: LumberjackState, n: number): LumberjackState {
  let s = state;
  for (let i = 0; i < n; i += 1) s = lumberjack.tick(s, IDLE);
  return s;
}

/** A state with a hand-built trunk and a full timer, for testing one rule at a time. */
function withTrunk(trunk: Branch[], side: Side = "left"): LumberjackState {
  const base = lumberjack.createInitialState(1);
  return { ...base, trunk, side, timeLeft: LUMBERJACK.timerMaxTicks };
}

/**
 * The side it is safe to chop on, given the trunk — the choice a competent player
 * makes. Mirrors the two death rules rather than the implementation, so a change
 * to either rule shows up as a failing survivability test.
 */
function safeSide(state: LumberjackState): Side | null {
  const sides: Side[] = ["left", "right"];
  return sides.find((s) => state.trunk[0] !== s && state.trunk[1] !== s) ?? null;
}

describe("lumberjack — module contract", () => {
  it("is a registered realtime module", () => {
    expect(lumberjack.id).toBe("lumberjack");
    expect(lumberjack.kind).toBe("realtime");
    expect(lumberjack.tickHz).toBeGreaterThan(0);
  });

  it("starts standing, at zero, with a full timer and a full trunk", () => {
    const state = lumberjack.createInitialState(1);
    expect(state.trunk).toHaveLength(LUMBERJACK.trunkHeight);
    expect(lumberjack.getScore(state)).toBe(0);
    expect(lumberjack.isGameOver(state)).toBe(false);
    expect(timeLeftFraction(state)).toBe(1);
  });

  it("never opens with a branch the player had no chance to read", () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const state = lumberjack.createInitialState(seed);
      for (let i = 0; i < LUMBERJACK.safeStartLogs; i += 1) {
        expect(state.trunk[i]).toBe("none");
      }
    }
  });
});

describe("lumberjack — determinism", () => {
  it("replays identically from the same seed and input log", () => {
    const inputs: LumberjackInput[] = Array.from({ length: 300 }, (_, i) => ({
      chop: i % 5 === 0 ? (i % 10 === 0 ? "left" : "right") : null,
    }));
    const run = (): LumberjackState => {
      let s = lumberjack.createInitialState(777);
      for (const input of inputs) s = lumberjack.tick(s, input);
      return s;
    };
    expect(run()).toEqual(run());
  });

  it("deals different trunks for different seeds", () => {
    const trunks = new Set(
      Array.from({ length: 50 }, (_, seed) => lumberjack.createInitialState(seed).trunk.join(",")),
    );
    expect(trunks.size).toBeGreaterThan(1);
  });
});

describe("lumberjack — the survivability invariant", () => {
  it("never grows a branch directly above another branch", () => {
    // The whole rule, checked on the dealt trunk...
    for (let seed = 0; seed < 300; seed += 1) {
      const state = lumberjack.createInitialState(seed);
      for (let i = 1; i < state.trunk.length; i += 1) {
        if (state.trunk[i - 1] !== "none") expect(state.trunk[i]).toBe("none");
      }
    }
  });

  it("holds for every log grown during a long run", () => {
    // ...and on every trunk the generator produces mid-run, which is where a
    // one-log-at-a-time generator would actually break it.
    for (let seed = 0; seed < 20; seed += 1) {
      let state = lumberjack.createInitialState(seed);
      for (let chop = 0; chop < 300 && !state.over; chop += 1) {
        const side = safeSide(state);
        expect(side).not.toBeNull();
        state = lumberjack.tick(state, { chop: side });
        for (let i = 1; i < state.trunk.length; i += 1) {
          if (state.trunk[i - 1] !== "none") expect(state.trunk[i]).toBe("none");
        }
      }
    }
  });

  it("always leaves a safe side to chop on", () => {
    // The player-facing consequence of the invariant: a competent player can
    // never be killed by the trunk — only by the clock.
    for (let seed = 0; seed < 20; seed += 1) {
      let state = lumberjack.createInitialState(seed);
      for (let chop = 0; chop < 400 && !state.over; chop += 1) {
        const side = safeSide(state);
        expect(side).not.toBeNull();
        state = lumberjack.tick(state, { chop: side });
        // Dying here would mean the trunk, not the clock, ended a perfect run.
        if (state.over) expect(state.timeLeft).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe("lumberjack — chopping", () => {
  it("scores, drops the trunk, and keeps it the same height", () => {
    const state = withTrunk(["none", "none", "left", "none", "none", "none", "none", "none"]);
    const after = lumberjack.tick(state, { chop: "right" });

    expect(lumberjack.getScore(after)).toBe(LUMBERJACK.chopScore);
    expect(after.over).toBe(false);
    expect(after.side).toBe("right");
    expect(after.trunk).toHaveLength(LUMBERJACK.trunkHeight);
    // Everything shifted down by one: the old index 2 branch is now at index 1.
    expect(after.trunk[1]).toBe("left");
  });

  it("does nothing but drain the clock on a tick with no chop", () => {
    const state = withTrunk(["none", "none", "none", "none", "none", "none", "none", "none"]);
    const after = lumberjack.tick(state, IDLE);
    expect(after.trunk).toEqual(state.trunk);
    expect(after.score).toBe(0);
    expect(after.timeLeft).toBeLessThan(state.timeLeft);
  });

  it("exposes the branch about to arrive, so a renderer can telegraph it", () => {
    const state = withTrunk(["none", "right", "none", "none", "none", "none", "none", "none"]);
    expect(incomingBranch(state)).toBe("right");
  });
});

describe("lumberjack — ways the run ends", () => {
  it("ends when you chop into a branch already at your height", () => {
    const state = withTrunk(["left", "none", "none", "none", "none", "none", "none", "none"]);
    const after = lumberjack.tick(state, { chop: "left" });
    expect(lumberjack.isGameOver(after)).toBe(true);
    expect(after.score).toBe(0);
  });

  it("ends when the log that drops onto you carries a branch on your side", () => {
    const state = withTrunk(["none", "right", "none", "none", "none", "none", "none", "none"]);
    const after = lumberjack.tick(state, { chop: "right" });
    expect(lumberjack.isGameOver(after)).toBe(true);
    // No score for the chop that killed you.
    expect(after.score).toBe(0);
  });

  it("survives the same trunk when you chop the other way", () => {
    const state = withTrunk(["none", "right", "none", "none", "none", "none", "none", "none"]);
    const after = lumberjack.tick(state, { chop: "left" });
    expect(after.over).toBe(false);
    expect(after.score).toBe(LUMBERJACK.chopScore);
  });

  it("ends when the timer runs out, even with a clear trunk", () => {
    const clear = withTrunk(["none", "none", "none", "none", "none", "none", "none", "none"]);
    const dead = idle(clear, LUMBERJACK.timerMaxTicks + 5);
    expect(lumberjack.isGameOver(dead)).toBe(true);
    expect(timeLeftFraction(dead)).toBe(0);
  });

  it("does not let a chop on the expiring tick beat the clock", () => {
    const clear = withTrunk(["none", "none", "none", "none", "none", "none", "none", "none"]);
    // One tick short of expiry, then chop on the tick the timer would run out.
    const onTheEdge: LumberjackState = { ...clear, timeLeft: drainPerTick(0) };
    const after = lumberjack.tick(onTheEdge, { chop: "left" });
    expect(lumberjack.isGameOver(after)).toBe(true);
    expect(after.score).toBe(0);
  });

  it("freezes once over — further ticks change nothing", () => {
    const over: LumberjackState = { ...withTrunk(["none", "none"]), over: true };
    expect(lumberjack.tick(over, { chop: "left" })).toBe(over);
    expect(lumberjack.getScore(idle(over, 50))).toBe(over.score);
  });
});

describe("lumberjack — the timer", () => {
  it("refills on a chop, capped at full", () => {
    const state: LumberjackState = {
      ...withTrunk(["none", "none", "none", "none", "none", "none", "none", "none"]),
      timeLeft: LUMBERJACK.timerMaxTicks / 2,
    };
    const after = lumberjack.tick(state, { chop: "left" });
    expect(after.timeLeft).toBeGreaterThan(state.timeLeft);
    expect(after.timeLeft).toBeLessThanOrEqual(LUMBERJACK.timerMaxTicks);

    // A chop on a nearly-full timer cannot overflow it.
    const nearlyFull = lumberjack.tick(
      { ...state, timeLeft: LUMBERJACK.timerMaxTicks },
      { chop: "left" },
    );
    expect(nearlyFull.timeLeft).toBe(LUMBERJACK.timerMaxTicks);
  });

  it("drains faster the longer the run goes, and never slower", () => {
    expect(drainPerTick(0)).toBe(1);
    expect(drainPerTick(LUMBERJACK.chopsPerDrainStep)).toBeGreaterThan(drainPerTick(0));
    for (let score = 0; score < 300; score += 1) {
      expect(drainPerTick(score + 1)).toBeGreaterThanOrEqual(drainPerTick(score));
    }
  });

  it("reports a fraction that stays inside 0..1", () => {
    const state = withTrunk(["none", "none"]);
    expect(timeLeftFraction({ ...state, timeLeft: -50 })).toBe(0);
    expect(timeLeftFraction({ ...state, timeLeft: LUMBERJACK.timerMaxTicks * 2 })).toBe(1);
  });
});
