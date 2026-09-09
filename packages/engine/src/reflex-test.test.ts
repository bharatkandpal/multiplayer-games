import { describe, it, expect } from "vitest";
import {
  REFLEX,
  averageTimeMs,
  bestTimeMs,
  reflexTest,
  type ReflexInput,
  type ReflexState,
} from "./reflex-test";
import { clearRealtimeRegistry, getRealtimeGame, listRealtimeGames } from "./realtime-registry";
import { registerBuiltInRealtimeGames } from "./realtime-games";

const IDLE: ReflexInput = { tap: false };
const TAP: ReflexInput = { tap: true };

const MS_PER_TICK = 1000 / reflexTest.tickHz;

/** Ticks with no input until the panel turns green. Throws rather than looping forever. */
function tickToGreen(start: ReflexState): ReflexState {
  let state = start;
  for (let i = 0; i < 10_000; i += 1) {
    if (state.light === "go") return state;
    state = reflexTest.tick(state, IDLE);
  }
  throw new Error("panel never turned green");
}

/** Waits for green, then idles `reactTicks` ticks before tapping — one full round. */
function playRound(start: ReflexState, reactTicks: number): ReflexState {
  let state = tickToGreen(start);
  // The tap lands on the `reactTicks`-th tick after green, recording that many ticks.
  for (let i = 0; i < reactTicks - 1; i += 1) {
    state = reflexTest.tick(state, IDLE);
  }
  return reflexTest.tick(state, TAP);
}

/** Plays a whole run, reacting in `reactTicks` ticks every round. */
function playRun(seed: number, reactTicks: number): ReflexState {
  let state = reflexTest.createInitialState(seed);
  for (let round = 0; round < REFLEX.rounds; round += 1) {
    state = playRound(state, reactTicks);
  }
  return state;
}

describe("reflexTest module", () => {
  it("exposes a valid RealtimeModule shape", () => {
    expect(reflexTest.id).toBe("reflex-test");
    expect(reflexTest.kind).toBe("realtime");
    expect(reflexTest.tickHz).toBeGreaterThan(0);
  });

  it("registers as a built-in realtime game", () => {
    clearRealtimeRegistry();
    registerBuiltInRealtimeGames();
    expect(listRealtimeGames()).toContain("reflex-test");
    expect(getRealtimeGame("reflex-test")).toBe(reflexTest);
  });

  it("starts red, with no rounds recorded and a score of 0", () => {
    const s0 = reflexTest.createInitialState(1);
    expect(s0.light).toBe("waiting");
    expect(s0.roundIndex).toBe(0);
    expect(s0.times).toEqual([]);
    expect(s0.over).toBe(false);
    expect(s0.falseStart).toBe(false);
    expect(reflexTest.getScore(s0)).toBe(0);
    expect(reflexTest.isGameOver(s0)).toBe(false);
  });

  it("holds red for at least the minimum wait before turning green", () => {
    // The whole point of the game: the flip must never be instant, or it is not
    // measuring a reaction.
    for (const seed of [1, 7, 99, 12345, 65535]) {
      let state = reflexTest.createInitialState(seed);
      let ticks = 0;
      while (state.light === "waiting") {
        state = reflexTest.tick(state, IDLE);
        ticks += 1;
      }
      expect(ticks * MS_PER_TICK).toBeGreaterThanOrEqual(REFLEX.minWaitMs);
      expect(ticks * MS_PER_TICK).toBeLessThanOrEqual(REFLEX.minWaitMs + REFLEX.maxExtraWaitMs);
    }
  });

  it("varies the wait length across seeds, so the flip can't be anticipated", () => {
    const waits = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => reflexTest.createInitialState(seed).waitTicks),
    );
    expect(waits.size).toBeGreaterThan(1);
  });

  it("records the reaction in ticks once green, and advances the round", () => {
    const green = tickToGreen(reflexTest.createInitialState(3));
    expect(green.times).toEqual([]);

    const after = playRound(green, 40); // 40 ticks @200Hz = 200ms
    expect(after.times).toEqual([200]);
    expect(after.roundIndex).toBe(1);
    expect(after.light).toBe("waiting");
    expect(after.over).toBe(false);
  });

  it("does not record a round while the player has not yet tapped", () => {
    let state = tickToGreen(reflexTest.createInitialState(3));
    for (let i = 0; i < 20; i += 1) state = reflexTest.tick(state, IDLE);
    expect(state.times).toEqual([]);
    expect(state.roundIndex).toBe(0);
    expect(state.reactTicks).toBe(20);
  });

  it("ends the run after exactly the configured number of rounds", () => {
    const final = playRun(11, 40);
    expect(final.roundIndex).toBe(REFLEX.rounds);
    expect(final.times).toHaveLength(REFLEX.rounds);
    expect(final.over).toBe(true);
    expect(reflexTest.isGameOver(final)).toBe(true);
  });

  it("freezes once over — further ticks are a no-op", () => {
    const final = playRun(11, 40);
    expect(reflexTest.tick(final, TAP)).toBe(final);
    expect(reflexTest.tick(final, IDLE)).toBe(final);
  });

  describe("false start", () => {
    it("ends the run and scores 0 when the player taps on red", () => {
      const s0 = reflexTest.createInitialState(5);
      const after = reflexTest.tick(s0, TAP);
      expect(after.falseStart).toBe(true);
      expect(after.over).toBe(true);
      expect(reflexTest.getScore(after)).toBe(0);
    });

    it("treats a tap on the very tick the wait expires as a false start", () => {
      // The panel is still red when that input is sampled, so it must not count as
      // a superhuman 0ms reaction.
      let state = reflexTest.createInitialState(5);
      while (state.waitTicks > 1) state = reflexTest.tick(state, IDLE);
      expect(state.light).toBe("waiting");
      const after = reflexTest.tick(state, TAP);
      expect(after.falseStart).toBe(true);
      expect(after.over).toBe(true);
    });

    it("scores 0 even after good rounds already banked", () => {
      // Mashing must never beat honest play: banked rounds are forfeit.
      let state = reflexTest.createInitialState(9);
      state = playRound(state, 30);
      state = playRound(state, 30);
      expect(state.times).toHaveLength(2);
      expect(reflexTest.getScore(state)).toBeGreaterThan(0);

      const mashed = reflexTest.tick(state, TAP);
      expect(mashed.falseStart).toBe(true);
      expect(reflexTest.getScore(mashed)).toBe(0);
    });

    it("cannot be beaten by tapping every single tick", () => {
      let state = reflexTest.createInitialState(21);
      for (let i = 0; i < 5000 && !state.over; i += 1) {
        state = reflexTest.tick(state, TAP);
      }
      expect(state.over).toBe(true);
      expect(state.falseStart).toBe(true);
      expect(reflexTest.getScore(state)).toBe(0);
    });
  });

  describe("timeout", () => {
    it("force-ends a round at the cap when the player never taps", () => {
      let state = tickToGreen(reflexTest.createInitialState(4));
      const timeoutTicks = REFLEX.timeoutMs / MS_PER_TICK;
      for (let i = 0; i < timeoutTicks; i += 1) state = reflexTest.tick(state, IDLE);
      expect(state.times).toEqual([REFLEX.timeoutMs]);
      expect(state.roundIndex).toBe(1);
    });

    it("completes a whole idle run rather than hanging forever", () => {
      let state = reflexTest.createInitialState(4);
      for (let i = 0; i < 200_000 && !state.over; i += 1) {
        state = reflexTest.tick(state, IDLE);
      }
      expect(state.over).toBe(true);
      expect(state.times).toHaveLength(REFLEX.rounds);
      expect(state.times.every((t) => t === REFLEX.timeoutMs)).toBe(true);
      // The worst possible honest run still scores 0 — but by flooring, not by
      // going negative.
      expect(reflexTest.getScore(state)).toBe(0);
    });
  });

  describe("scoring", () => {
    it("reports best and average across completed rounds", () => {
      let state = reflexTest.createInitialState(13);
      state = playRound(state, 60); // 300ms
      state = playRound(state, 40); // 200ms
      state = playRound(state, 50); // 250ms
      expect(state.times).toEqual([300, 200, 250]);
      expect(bestTimeMs(state)).toBe(200);
      expect(averageTimeMs(state)).toBe(250);
    });

    it("has no best/average before any round completes", () => {
      const s0 = reflexTest.createInitialState(13);
      expect(bestTimeMs(s0)).toBeNull();
      expect(averageTimeMs(s0)).toBeNull();
    });

    it("converts the average to a higher-is-better score", () => {
      // The leaderboard ranks descending, so a faster run MUST score higher.
      const final = playRun(17, 40); // 200ms average
      expect(averageTimeMs(final)).toBe(200);
      expect(reflexTest.getScore(final)).toBe(REFLEX.scoreBaselineMs - 200);
    });

    it("scores a faster run above a slower one", () => {
      const fast = reflexTest.getScore(playRun(17, 30)); // 150ms
      const mid = reflexTest.getScore(playRun(17, 50)); // 250ms
      const slow = reflexTest.getScore(playRun(17, 80)); // 400ms
      expect(fast).toBeGreaterThan(mid);
      expect(mid).toBeGreaterThan(slow);
    });

    it("never returns a negative score for a very slow run", () => {
      const state = playRun(17, REFLEX.timeoutMs / MS_PER_TICK);
      expect(reflexTest.getScore(state)).toBe(0);
    });
  });

  describe("purity and determinism", () => {
    it("produces an identical run from the same seed and inputs", () => {
      const a = playRun(2024, 45);
      const b = playRun(2024, 45);
      expect(b).toEqual(a);
      expect(reflexTest.getScore(b)).toBe(reflexTest.getScore(a));
    });

    it("does not mutate the state passed to tick", () => {
      const s0 = reflexTest.createInitialState(31);
      // State is plain serializable data, so a JSON round-trip is a sufficient
      // deep copy here (and avoids depending on `structuredClone` being in lib).
      const snapshot = JSON.parse(JSON.stringify(s0)) as ReflexState;
      reflexTest.tick(s0, IDLE);
      reflexTest.tick(s0, TAP);
      expect(s0).toEqual(snapshot);
    });

    it("gives different seeds different wait sequences", () => {
      const waitsFor = (seed: number): number[] => {
        let state = reflexTest.createInitialState(seed);
        const waits: number[] = [state.waitTicks];
        for (let round = 0; round < REFLEX.rounds - 1; round += 1) {
          state = playRound(state, 40);
          waits.push(state.waitTicks);
        }
        return waits;
      };
      expect(waitsFor(1)).not.toEqual(waitsFor(2));
    });
  });
});
