import { describe, expect, it } from "vitest";
import {
  aimTrainer,
  AIM,
  AIM_CELLS,
  cellAt,
  lifetimeFor,
  missesLeft,
  spawnTicksFor,
  type AimTrainerInput,
  type AimTrainerState,
} from "./aim-trainer";

const IDLE: AimTrainerInput = { tap: null };

/** Runs `n` ticks with no input. */
function idle(state: AimTrainerState, n: number): AimTrainerState {
  let s = state;
  for (let i = 0; i < n; i += 1) s = aimTrainer.tick(s, IDLE);
  return s;
}

/** The normalised centre of `cell` — what a tap on that cell looks like. */
function centreOf(cell: number): { x: number; y: number } {
  const col = cell % AIM.cols;
  const row = Math.floor(cell / AIM.cols);
  return { x: (col + 0.5) / AIM.cols, y: (row + 0.5) / AIM.rows };
}

/** Taps the first target on the board. */
function tapFirstTarget(state: AimTrainerState): AimTrainerState {
  const target = state.targets[0];
  if (target === undefined) return aimTrainer.tick(state, IDLE);
  return aimTrainer.tick(state, { tap: centreOf(target.cell) });
}

/** A cell with no target on it. */
function emptyCell(state: AimTrainerState): number {
  const taken = new Set(state.targets.map((t) => t.cell));
  for (let i = 0; i < AIM_CELLS; i += 1) if (!taken.has(i)) return i;
  return 0;
}

describe("aim-trainer — module contract", () => {
  it("is a registered realtime module", () => {
    expect(aimTrainer.id).toBe("aim-trainer");
    expect(aimTrainer.kind).toBe("realtime");
    expect(aimTrainer.tickHz).toBeGreaterThan(0);
  });

  it("opens with a target already up, not an empty board", () => {
    const state = aimTrainer.createInitialState(1);
    expect(state.targets).toHaveLength(1);
    expect(aimTrainer.getScore(state)).toBe(0);
    expect(missesLeft(state)).toBe(AIM.maxMisses);
    expect(aimTrainer.isGameOver(state)).toBe(false);
  });

  it("only ever places targets on real cells", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      let state = aimTrainer.createInitialState(seed);
      for (let i = 0; i < 200 && !state.over; i += 1) {
        state = tapFirstTarget(state);
        for (const target of state.targets) {
          expect(target.cell).toBeGreaterThanOrEqual(0);
          expect(target.cell).toBeLessThan(AIM_CELLS);
        }
      }
    }
  });

  it("never stacks two targets on one cell", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      let state = aimTrainer.createInitialState(seed);
      for (let i = 0; i < 200 && !state.over; i += 1) {
        state = i % 3 === 0 ? tapFirstTarget(state) : aimTrainer.tick(state, IDLE);
        const cells = state.targets.map((t) => t.cell);
        expect(new Set(cells).size).toBe(cells.length);
      }
    }
  });

  it("never exceeds the concurrent-target cap", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      let state = aimTrainer.createInitialState(seed);
      for (let i = 0; i < 300 && !state.over; i += 1) {
        state = aimTrainer.tick(state, IDLE);
        expect(state.targets.length).toBeLessThanOrEqual(AIM.maxTargets);
      }
    }
  });
});

describe("aim-trainer — determinism", () => {
  it("replays identically from the same seed and input log", () => {
    const inputs: AimTrainerInput[] = Array.from({ length: 400 }, (_, i) => ({
      tap: i % 11 === 0 ? centreOf(i % AIM_CELLS) : null,
    }));
    const run = (): AimTrainerState => {
      let s = aimTrainer.createInitialState(8080);
      for (const input of inputs) s = aimTrainer.tick(s, input);
      return s;
    };
    expect(run()).toEqual(run());
  });

  it("opens on different cells across seeds", () => {
    const cells = new Set(
      Array.from({ length: 60 }, (_, seed) => aimTrainer.createInitialState(seed).targets[0]?.cell),
    );
    expect(cells.size).toBeGreaterThan(1);
  });
});

describe("aim-trainer — the tap-to-cell mapping", () => {
  it("maps a normalised position onto the right cell", () => {
    expect(cellAt(0, 0)).toBe(0);
    expect(cellAt(0.99, 0)).toBe(AIM.cols - 1);
    expect(cellAt(0, 0.99)).toBe((AIM.rows - 1) * AIM.cols);
    expect(cellAt(0.99, 0.99)).toBe(AIM_CELLS - 1);
  });

  it("clamps an on-edge or out-of-range tap into the board", () => {
    // A tap at exactly 1 is the last column, not a rounding failure; a tap
    // outside the surface is still the nearest cell, never an invalid index.
    expect(cellAt(1, 1)).toBe(AIM_CELLS - 1);
    expect(cellAt(-0.5, -0.5)).toBe(0);
    expect(cellAt(4, 4)).toBe(AIM_CELLS - 1);
  });

  it("round-trips every cell through its own centre", () => {
    for (let cell = 0; cell < AIM_CELLS; cell += 1) {
      const { x, y } = centreOf(cell);
      expect(cellAt(x, y)).toBe(cell);
    }
  });
});

describe("aim-trainer — hits and misses", () => {
  it("scores a hit and clears the target", () => {
    const state = aimTrainer.createInitialState(3);
    const cell = state.targets[0]!.cell;
    const after = aimTrainer.tick(state, { tap: centreOf(cell) });

    expect(aimTrainer.getScore(after)).toBe(AIM.hitScore);
    expect(after.hits).toBe(1);
    expect(after.targets.map((t) => t.cell)).not.toContain(cell);
    expect(after.misses).toBe(0);
  });

  it("counts a tap on nothing as a miss — spraying the board is not aiming", () => {
    const state = aimTrainer.createInitialState(3);
    const after = aimTrainer.tick(state, { tap: centreOf(emptyCell(state)) });
    expect(after.misses).toBe(1);
    expect(after.score).toBe(0);
    expect(missesLeft(after)).toBe(AIM.maxMisses - 1);
  });

  it("counts an expired target as a miss", () => {
    const state = aimTrainer.createInitialState(3);
    const lifetime = state.targets[0]!.ticksLeft;
    const after = idle(state, lifetime);
    expect(after.misses).toBeGreaterThanOrEqual(1);
  });

  it("ends the run once the miss budget is gone", () => {
    let state = aimTrainer.createInitialState(3);
    for (let i = 0; i < AIM.maxMisses && !state.over; i += 1) {
      state = aimTrainer.tick(state, { tap: centreOf(emptyCell(state)) });
    }
    expect(aimTrainer.isGameOver(state)).toBe(true);
    expect(missesLeft(state)).toBe(0);
  });

  it("spawns nothing once the run is over", () => {
    let state = aimTrainer.createInitialState(3);
    while (!state.over) state = aimTrainer.tick(state, { tap: centreOf(emptyCell(state)) });
    const frozen = idle(state, 100);
    expect(frozen).toBe(state);
  });

  it("freezes once over — further ticks change nothing", () => {
    const over: AimTrainerState = { ...aimTrainer.createInitialState(3), over: true };
    expect(aimTrainer.tick(over, { tap: { x: 0.5, y: 0.5 } })).toBe(over);
    expect(aimTrainer.getScore(idle(over, 50))).toBe(over.score);
  });
});

describe("aim-trainer — the difficulty ramp", () => {
  it("spawns faster and shortens lifetimes as hits accumulate, down to floors", () => {
    expect(spawnTicksFor(0)).toBe(AIM.startSpawnTicks);
    expect(lifetimeFor(0)).toBe(AIM.startLifetimeTicks);
    expect(spawnTicksFor(AIM.hitsPerStep)).toBeLessThan(spawnTicksFor(0));
    expect(lifetimeFor(AIM.hitsPerStep)).toBeLessThan(lifetimeFor(0));
    expect(spawnTicksFor(100_000)).toBe(AIM.minSpawnTicks);
    expect(lifetimeFor(100_000)).toBe(AIM.minLifetimeTicks);
  });

  it("never ramps backwards", () => {
    for (let hits = 0; hits < 300; hits += 1) {
      expect(spawnTicksFor(hits + 1)).toBeLessThanOrEqual(spawnTicksFor(hits));
      expect(lifetimeFor(hits + 1)).toBeLessThanOrEqual(lifetimeFor(hits));
    }
  });

  it("stays playable: a perfect player keeps scoring and never runs out of board", () => {
    // Hitting every target the tick it appears should never end the run, and
    // should never deadlock on a full board.
    let state = aimTrainer.createInitialState(12);
    for (let i = 0; i < 500 && !state.over; i += 1) {
      state = state.targets.length > 0 ? tapFirstTarget(state) : aimTrainer.tick(state, IDLE);
    }
    expect(state.over).toBe(false);
    expect(aimTrainer.getScore(state)).toBeGreaterThan(0);
  });
});
