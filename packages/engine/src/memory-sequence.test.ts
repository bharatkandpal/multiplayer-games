import { describe, expect, it } from "vitest";
import {
  memorySequence,
  MEMORY,
  PAD_COUNT,
  inputTicksFor,
  inputTimeFraction,
  litPad,
  round,
  type MemorySequenceInput,
  type MemorySequenceState,
  type PadIndex,
} from "./memory-sequence";

const IDLE: MemorySequenceInput = { pad: null };

/** Runs `n` ticks with no input. */
function idle(state: MemorySequenceState, n: number): MemorySequenceState {
  let s = state;
  for (let i = 0; i < n; i += 1) s = memorySequence.tick(s, IDLE);
  return s;
}

/** Ticks until the player's turn (or `over`), so a test can start from the answer. */
function toInputPhase(state: MemorySequenceState): MemorySequenceState {
  let s = state;
  for (let i = 0; i < 2000 && s.phase !== "input" && !s.over; i += 1)
    s = memorySequence.tick(s, IDLE);
  return s;
}

/** Plays the sequence back correctly, one pad per tick. */
function answerCorrectly(state: MemorySequenceState): MemorySequenceState {
  let s = state;
  for (const pad of state.sequence) {
    s = memorySequence.tick(s, { pad });
  }
  return s;
}

/** Plays one full round: watch the playback, then answer it. */
function playRound(state: MemorySequenceState): MemorySequenceState {
  return answerCorrectly(toInputPhase(state));
}

describe("memory-sequence — module contract", () => {
  it("is a registered realtime module", () => {
    expect(memorySequence.id).toBe("memory-sequence");
    expect(memorySequence.kind).toBe("realtime");
    expect(memorySequence.tickHz).toBeGreaterThan(0);
  });

  it("starts on round one, showing, with nothing scored", () => {
    const state = memorySequence.createInitialState(1);
    expect(round(state)).toBe(1);
    expect(state.phase).toBe("pre-show");
    expect(memorySequence.getScore(state)).toBe(0);
    expect(memorySequence.isGameOver(state)).toBe(false);
  });

  it("only ever produces valid pads", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      let state = memorySequence.createInitialState(seed);
      for (let r = 0; r < 12 && !state.over; r += 1) state = playRound(state);
      for (const pad of state.sequence) {
        expect(pad).toBeGreaterThanOrEqual(0);
        expect(pad).toBeLessThan(PAD_COUNT);
        expect(Number.isInteger(pad)).toBe(true);
      }
    }
  });
});

describe("memory-sequence — determinism", () => {
  it("replays identically from the same seed and input log", () => {
    const inputs: MemorySequenceInput[] = Array.from({ length: 500 }, (_, i) => ({
      pad: i % 23 === 0 ? ((i % PAD_COUNT) as PadIndex) : null,
    }));
    const run = (): MemorySequenceState => {
      let s = memorySequence.createInitialState(31337);
      for (const input of inputs) s = memorySequence.tick(s, input);
      return s;
    };
    expect(run()).toEqual(run());
  });

  it("deals different opening pads across seeds", () => {
    const first = new Set(
      Array.from({ length: 60 }, (_, seed) => memorySequence.createInitialState(seed).sequence[0]),
    );
    expect(first.size).toBeGreaterThan(1);
  });

  it("never repeats a pad back-to-back — two identical flashes can't be counted", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      let state = memorySequence.createInitialState(seed);
      for (let r = 0; r < 15 && !state.over; r += 1) state = playRound(state);
      for (let i = 1; i < state.sequence.length; i += 1) {
        expect(state.sequence[i]).not.toBe(state.sequence[i - 1]);
      }
    }
  });
});

describe("memory-sequence — playback is simulation, not animation", () => {
  it("flashes each pad in order, with a dark gap between them", () => {
    // Drive a known two-pad sequence so the assertions are about timing only.
    const base = memorySequence.createInitialState(2);
    const state: MemorySequenceState = { ...base, sequence: [1, 3] };

    // The pre-show beat is silent.
    expect(litPad(state)).toBeNull();
    const showing = idle(state, MEMORY.preShowTicks);
    expect(showing.phase).toBe("showing");
    expect(litPad(showing)).toBe(1);

    // ...lit for padOnTicks, then dark for the gap...
    const duringGap = idle(showing, MEMORY.padOnTicks);
    expect(litPad(duringGap)).toBeNull();

    // ...then the second pad.
    const second = idle(showing, MEMORY.padOnTicks + MEMORY.padGapTicks);
    expect(litPad(second)).toBe(3);
  });

  it("hands the turn over once the whole sequence has played", () => {
    const state = toInputPhase(memorySequence.createInitialState(2));
    expect(state.phase).toBe("input");
    expect(state.inputIndex).toBe(0);
    expect(state.inputTicksLeft).toBe(inputTicksFor(state.sequence.length));
  });

  it("ignores presses during playback rather than punishing them", () => {
    const state = memorySequence.createInitialState(2);
    // Hammer a pad that is certainly wrong for position 0 at some point.
    let s = state;
    for (let i = 0; i < MEMORY.preShowTicks + MEMORY.padOnTicks; i += 1) {
      const wrong = (((s.sequence[0] ?? 0) + 1) % PAD_COUNT) as PadIndex;
      s = memorySequence.tick(s, { pad: wrong });
      expect(s.over).toBe(false);
    }
    expect(s.score).toBe(0);
  });
});

describe("memory-sequence — answering", () => {
  it("scores the round and grows the sequence on a correct answer", () => {
    const start = toInputPhase(memorySequence.createInitialState(5));
    const after = answerCorrectly(start);

    expect(memorySequence.getScore(after)).toBe(1);
    expect(round(after)).toBe(round(start) + 1);
    expect(after.phase).toBe("pre-show");
    expect(after.over).toBe(false);
  });

  it("keeps the earlier pads when it grows — it's one sequence, not a new one", () => {
    const start = toInputPhase(memorySequence.createInitialState(5));
    const after = answerCorrectly(start);
    expect(after.sequence.slice(0, start.sequence.length)).toEqual(start.sequence);
  });

  it("plays many rounds, scoring one per round", () => {
    let state = memorySequence.createInitialState(11);
    for (let r = 0; r < 8; r += 1) state = playRound(state);
    expect(memorySequence.getScore(state)).toBe(8);
    expect(round(state)).toBe(9);
    expect(state.over).toBe(false);
  });

  it("ends the run on a wrong pad", () => {
    const start = toInputPhase(memorySequence.createInitialState(5));
    const wrong = (((start.sequence[0] ?? 0) + 1) % PAD_COUNT) as PadIndex;
    const after = memorySequence.tick(start, { pad: wrong });
    expect(memorySequence.isGameOver(after)).toBe(true);
    expect(memorySequence.getScore(after)).toBe(0);
  });

  it("ends the run on a wrong pad mid-sequence, after correct ones", () => {
    // Reach a round with at least two pads, then get the second one wrong.
    let state = playRound(memorySequence.createInitialState(5));
    state = toInputPhase(state);
    expect(state.sequence.length).toBeGreaterThanOrEqual(2);

    const first = state.sequence[0]!;
    const correctSecond = state.sequence[1]!;
    const wrong = ((correctSecond + 1) % PAD_COUNT) as PadIndex;

    const afterFirst = memorySequence.tick(state, { pad: first });
    expect(afterFirst.over).toBe(false);
    expect(afterFirst.inputIndex).toBe(1);

    const dead = memorySequence.tick(afterFirst, { pad: wrong });
    expect(dead.over).toBe(true);
    // The round in progress doesn't score — only completed rounds do.
    expect(memorySequence.getScore(dead)).toBe(1);
  });

  it("flashes back whatever the player pressed, including the fatal pad", () => {
    const start = toInputPhase(memorySequence.createInitialState(5));
    const wrong = (((start.sequence[0] ?? 0) + 1) % PAD_COUNT) as PadIndex;
    const after = memorySequence.tick(start, { pad: wrong });
    expect(after.pressFlashPad).toBe(wrong);
    expect(litPad(after)).toBe(wrong);
  });
});

describe("memory-sequence — the turn clock", () => {
  it("ends the run when the player's turn runs out", () => {
    const start = toInputPhase(memorySequence.createInitialState(5));
    const dead = idle(start, inputTicksFor(start.sequence.length) + 2);
    expect(memorySequence.isGameOver(dead)).toBe(true);
    expect(memorySequence.getScore(dead)).toBe(0);
  });

  it("gives a longer sequence a longer turn", () => {
    expect(inputTicksFor(5)).toBeGreaterThan(inputTicksFor(1));
  });

  it("reports a fraction inside 0..1, and a full one outside the input phase", () => {
    const showing = memorySequence.createInitialState(5);
    expect(inputTimeFraction(showing)).toBe(1);

    const answering = toInputPhase(showing);
    expect(inputTimeFraction(answering)).toBeLessThanOrEqual(1);
    expect(inputTimeFraction(answering)).toBeGreaterThan(0);
    expect(inputTimeFraction({ ...answering, inputTicksLeft: -10 })).toBe(0);
  });

  it("a run cannot stall forever with no input", () => {
    // The point of the turn clock: an idle run terminates, so a replay is
    // bounded and the leaderboard can't be farmed by never answering.
    const dead = idle(memorySequence.createInitialState(5), 5000);
    expect(memorySequence.isGameOver(dead)).toBe(true);
  });

  it("freezes once over — further ticks change nothing", () => {
    const over: MemorySequenceState = { ...memorySequence.createInitialState(5), over: true };
    expect(memorySequence.tick(over, { pad: 0 })).toBe(over);
    expect(memorySequence.getScore(idle(over, 50))).toBe(over.score);
  });
});
