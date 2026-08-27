import { describe, it, expect } from "vitest";
import { floppyBirds, WORLD, type FloppyInput, type FloppyState } from "./floppy-birds";
import { clearRealtimeRegistry, getRealtimeGame, listRealtimeGames } from "./realtime-registry";
import { registerBuiltInRealtimeGames } from "./realtime-games";

const NO_FLAP: FloppyInput = { flap: false };
const FLAP: FloppyInput = { flap: true };

/** Runs a scripted input sequence from a seed, returning every state (inclusive of start). */
function run(seed: number, inputs: readonly FloppyInput[]): FloppyState[] {
  const states: FloppyState[] = [floppyBirds.createInitialState(seed)];
  for (const input of inputs) {
    states.push(floppyBirds.tick(states[states.length - 1]!, input));
  }
  return states;
}

/** The tick index at which the run first ended, or -1 if it never did. */
function gameOverTick(states: readonly FloppyState[]): number {
  return states.findIndex((s) => s.over);
}

describe("floppyBirds module", () => {
  it("exposes a valid RealtimeModule shape", () => {
    expect(floppyBirds.id).toBe("floppy-birds");
    expect(floppyBirds.kind).toBe("realtime");
    expect(floppyBirds.tickHz).toBeGreaterThan(0);
  });

  it("registers as a built-in realtime game", () => {
    clearRealtimeRegistry();
    registerBuiltInRealtimeGames();
    expect(listRealtimeGames()).toContain("floppy-birds");
    expect(getRealtimeGame("floppy-birds")).toBe(floppyBirds);
  });

  it("starts alive, centered, with score 0 and one pipe", () => {
    const s0 = floppyBirds.createInitialState(1);
    expect(s0.over).toBe(false);
    expect(floppyBirds.isGameOver(s0)).toBe(false);
    expect(floppyBirds.getScore(s0)).toBe(0);
    expect(s0.birdY).toBe(WORLD.height / 2);
    expect(s0.pipes).toHaveLength(1);
  });

  it("is deterministic: same seed + same inputs → identical run (no timers/DOM)", () => {
    const inputs = Array.from({ length: 200 }, (_, i): FloppyInput => ({ flap: i % 10 === 0 }));
    const a = run(42, inputs);
    const b = run(42, inputs);
    expect(a).toEqual(b);
    const last = a[a.length - 1]!;
    expect(floppyBirds.getScore(last)).toBe(floppyBirds.getScore(b[b.length - 1]!));
    expect(floppyBirds.isGameOver(last)).toBe(floppyBirds.isGameOver(b[b.length - 1]!));
  });

  it("diverges on a different seed (randomness derives from the seed)", () => {
    // The first pipe's gap position is seeded, so two seeds place it differently.
    const gapA = floppyBirds.createInitialState(1).pipes[0]!.gapY;
    const gapB = floppyBirds.createInitialState(2).pipes[0]!.gapY;
    expect(gapA).not.toBe(gapB);
  });

  it("with no flaps the bird falls and the run ends with score 0", () => {
    const states = run(
      7,
      Array.from({ length: 90 }, () => NO_FLAP),
    );
    const overAt = gameOverTick(states);
    expect(overAt).toBeGreaterThan(0); // it does end
    expect(states[overAt]!.birdY).toBeGreaterThan(WORLD.height / 2); // fell downward
    expect(floppyBirds.getScore(states[overAt]!)).toBe(0); // died before any pipe
  });

  it("flapping every tick flies the bird into the ceiling (also ends, score 0)", () => {
    const states = run(
      7,
      Array.from({ length: 90 }, () => FLAP),
    );
    const overAt = gameOverTick(states);
    expect(overAt).toBeGreaterThan(0);
    expect(states[overAt]!.birdY).toBeLessThan(WORLD.height / 2); // flew upward
    expect(floppyBirds.getScore(states[overAt]!)).toBe(0);
  });

  it("scores when the bird clears a pipe's trailing edge inside the gap", () => {
    // Hand-built state: a single unscored pipe positioned so that after one tick its
    // trailing edge passes birdX, with the bird centered in the gap (no collision).
    const state: FloppyState = {
      birdY: WORLD.height / 2,
      birdV: 0,
      pipes: [{ x: 15.5, gapY: WORLD.height / 2, scored: false }],
      score: 0,
      over: false,
      rng: { s: 123 },
      t: 0,
    };
    const next = floppyBirds.tick(state, NO_FLAP);
    expect(next.over).toBe(false);
    expect(floppyBirds.getScore(next)).toBe(1);
    // Idempotent scoring: once marked scored, it never double-counts.
    expect(floppyBirds.tick(next, NO_FLAP).score).toBe(1);
  });

  it("ends when the bird strikes a pipe body outside the gap", () => {
    // Bird overlapping a pipe's x-range but well below its gap → collision.
    const state: FloppyState = {
      birdY: 90,
      birdV: 0,
      pipes: [{ x: WORLD.birdX, gapY: 20, scored: false }],
      score: 3,
      over: false,
      rng: { s: 1 },
      t: 0,
    };
    const next = floppyBirds.tick(state, NO_FLAP);
    expect(next.over).toBe(true);
    expect(floppyBirds.isGameOver(next)).toBe(true);
    expect(floppyBirds.getScore(next)).toBe(3); // score is final at game over
  });

  it("is a no-op once over: ticking a finished run returns the same state", () => {
    const over: FloppyState = {
      birdY: 50,
      birdV: 0,
      pipes: [],
      score: 5,
      over: true,
      rng: { s: 1 },
      t: 10,
    };
    expect(floppyBirds.tick(over, FLAP)).toBe(over);
  });

  it("does not mutate the input state (pure tick)", () => {
    const s0 = floppyBirds.createInitialState(3);
    const snapshot = JSON.parse(JSON.stringify(s0)) as FloppyState;
    floppyBirds.tick(s0, FLAP);
    expect(s0).toEqual(snapshot);
  });
});
