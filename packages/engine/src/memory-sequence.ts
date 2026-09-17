// Memory Sequence (MPG-141) — a solo real-time arcade game implementing the pure
// RealtimeModule<S, I> contract (ADR 0002). Simon, essentially: the game flashes a
// sequence of pads, you repeat it, and the sequence grows by one pad each round.
// One wrong pad ends the run; so does running down the clock on your turn.
//
// PURE, like every module in this family: no clock, no rAF, no Math.random. The
// sequence derives entirely from the seeded PRNG carried in state (see ./prng),
// so a run is a deterministic function of (seed, input log) — replayable
// server-side to validate a submitted score (MPG-065).
//
// **The playback is simulation state, not a renderer animation**, and that is the
// design decision this module turns on. It would be easy to let the web layer own
// "flash the pads" on a timer and have the engine only score the answer — but then
// the run would not re-simulate (the server has no renderer), the input log would
// mean nothing without knowing when the flashes happened, and the leaderboard
// would be unverifiable. So the phase machine lives here, advanced purely by
// `tick`, and the renderer only reads `litPad(state)`.

import { nextFloat, seedPrng, type PrngState } from "./prng";
import type { RealtimeModule } from "./realtime";

/** The four pads, by index. */
export type PadIndex = 0 | 1 | 2 | 3;

export const PAD_COUNT = 4;

/** Per-tick input: a pad press, or `null` on the (many) ticks with no input. */
export interface MemorySequenceInput {
  readonly pad: PadIndex | null;
}

/**
 * Where the round is.
 *
 * - `pre-show` — a beat of silence before playback, so the first flash isn't
 *   missed and a new round is visibly a new round.
 * - `showing` — the game is playing the sequence back. Presses are IGNORED here,
 *   not punished: pressing during playback is impatience, not a wrong answer.
 * - `input` — the player's turn, under a per-round time limit.
 */
export type MemoryPhase = "pre-show" | "showing" | "input";

export interface MemorySequenceState {
  /** The full sequence for this round; its length is the round number. */
  readonly sequence: readonly PadIndex[];
  readonly phase: MemoryPhase;
  /** Ticks elapsed in the current phase step (one pad's flash, or the pre-show beat). */
  readonly phaseTicks: number;
  /** Which sequence position is being flashed, while `showing`. */
  readonly showIndex: number;
  /** How much of the sequence the player has correctly entered this round. */
  readonly inputIndex: number;
  /** Ticks left on the player's turn. Only meaningful while `input`. */
  readonly inputTicksLeft: number;
  /**
   * A pad to flash back at the player because they just pressed it, and the ticks
   * left on that flash. Purely for feedback — it never affects the rules — but it
   * lives in state so the renderer stays a pure projection with no timers.
   */
  readonly pressFlashPad: PadIndex | null;
  readonly pressFlashTicks: number;
  /** Completed rounds — the score. */
  readonly score: number;
  readonly over: boolean;
  readonly rng: PrngState;
}

export const MEMORY = {
  /** Ticks a pad stays lit during playback. */
  padOnTicks: 12,
  /** Dark ticks between two flashes — what makes two pads two pads. */
  padGapTicks: 7,
  /** The beat of silence before a round's playback begins. */
  preShowTicks: 18,
  /** Ticks a pad flashes back when the PLAYER presses it (feedback only). */
  pressFlashTicks: 7,
  /** Base ticks on the player's turn... */
  inputBaseTicks: 45,
  /** ...plus this much per pad in the sequence. A longer sequence gets longer. */
  inputTicksPerPad: 30,
} as const;

/**
 * 30Hz. The sim resolves pad flashes and a countdown — there is no physics to
 * integrate — so 33ms granularity is far finer than the mechanic needs, and
 * halving 60Hz halves the input log replayed server-side.
 */
const TICK_HZ = 30;

/** Ticks the player gets to answer a sequence of `length` pads. */
export function inputTicksFor(length: number): number {
  return MEMORY.inputBaseTicks + MEMORY.inputTicksPerPad * length;
}

/**
 * Picks the next pad, never repeating the one before it.
 *
 * Classic Simon allows a doubled pad; this doesn't, on purpose. Two identical
 * flashes in a row are genuinely ambiguous to watch — there is no way to tell one
 * long flash from two short ones except by counting frames — so a doubled pad
 * tests the player's eyesight rather than their memory. Pure: advances the RNG.
 */
function nextPad(
  previous: PadIndex | undefined,
  rng: PrngState,
): { pad: PadIndex; rng: PrngState } {
  const roll = nextFloat(rng);
  if (previous === undefined) {
    return { pad: Math.floor(roll.value * PAD_COUNT) as PadIndex, rng: roll.next };
  }
  // Choose among the three pads that aren't the previous one, then map back.
  const offset = Math.floor(roll.value * (PAD_COUNT - 1));
  return { pad: ((previous + 1 + offset) % PAD_COUNT) as PadIndex, rng: roll.next };
}

/**
 * The pad that should be lit right now, or `null` for none — the renderer's whole
 * input. Covers both the game's playback and the flash-back on a player press, so
 * a renderer never has to know which phase produced the light.
 */
export function litPad(state: MemorySequenceState): PadIndex | null {
  if (state.phase === "showing" && state.phaseTicks < MEMORY.padOnTicks) {
    return state.sequence[state.showIndex] ?? null;
  }
  if (state.pressFlashTicks > 0) return state.pressFlashPad;
  return null;
}

/** Fraction of the player's turn still left (0..1) — for a countdown indicator. */
export function inputTimeFraction(state: MemorySequenceState): number {
  if (state.phase !== "input") return 1;
  const total = inputTicksFor(state.sequence.length);
  return Math.max(0, Math.min(1, state.inputTicksLeft / total));
}

/** The round the player is on — one more than the rounds they've completed. */
export function round(state: MemorySequenceState): number {
  return state.sequence.length;
}

/** Decays the press-flash by one tick. Feedback only; never touches the rules. */
function decayFlash(
  state: MemorySequenceState,
): Pick<MemorySequenceState, "pressFlashPad" | "pressFlashTicks"> {
  const ticks = Math.max(0, state.pressFlashTicks - 1);
  return { pressFlashPad: ticks === 0 ? null : state.pressFlashPad, pressFlashTicks: ticks };
}

export const memorySequence: RealtimeModule<MemorySequenceState, MemorySequenceInput> = {
  id: "memory-sequence",
  kind: "realtime",
  tickHz: TICK_HZ,

  createInitialState(seed: number): MemorySequenceState {
    const first = nextPad(undefined, seedPrng(seed));
    return {
      sequence: [first.pad],
      phase: "pre-show",
      phaseTicks: 0,
      showIndex: 0,
      inputIndex: 0,
      inputTicksLeft: 0,
      pressFlashPad: null,
      pressFlashTicks: 0,
      score: 0,
      over: false,
      rng: first.rng,
    };
  },

  tick(state: MemorySequenceState, input: MemorySequenceInput): MemorySequenceState {
    // Once over, the run is frozen — ticks are a no-op (the score is final).
    if (state.over) return state;
    const flash = decayFlash(state);

    if (state.phase === "pre-show") {
      const phaseTicks = state.phaseTicks + 1;
      if (phaseTicks < MEMORY.preShowTicks) return { ...state, ...flash, phaseTicks };
      return { ...state, ...flash, phase: "showing", phaseTicks: 0, showIndex: 0 };
    }

    if (state.phase === "showing") {
      const phaseTicks = state.phaseTicks + 1;
      if (phaseTicks < MEMORY.padOnTicks + MEMORY.padGapTicks) {
        return { ...state, ...flash, phaseTicks };
      }
      const showIndex = state.showIndex + 1;
      if (showIndex < state.sequence.length) {
        return { ...state, ...flash, phaseTicks: 0, showIndex };
      }
      // Playback finished — hand the turn over, with a fresh clock on it.
      return {
        ...state,
        ...flash,
        phase: "input",
        phaseTicks: 0,
        inputIndex: 0,
        inputTicksLeft: inputTicksFor(state.sequence.length),
      };
    }

    // phase === "input"
    const inputTicksLeft = state.inputTicksLeft - 1;
    if (inputTicksLeft <= 0) {
      return { ...state, ...flash, inputTicksLeft: 0, over: true };
    }

    const pad = input.pad;
    if (pad === null) return { ...state, ...flash, inputTicksLeft };

    // A press always flashes back, right or wrong — the player should see that
    // the game registered the pad they hit, including the one that killed them.
    const pressed = { pressFlashPad: pad, pressFlashTicks: MEMORY.pressFlashTicks };

    if (state.sequence[state.inputIndex] !== pad) {
      return { ...state, ...pressed, inputTicksLeft, over: true };
    }

    const inputIndex = state.inputIndex + 1;
    if (inputIndex < state.sequence.length) {
      return { ...state, ...pressed, inputTicksLeft, inputIndex };
    }

    // Round complete: score it, grow the sequence, and play the new one back.
    const grown = nextPad(state.sequence[state.sequence.length - 1], state.rng);
    return {
      ...state,
      ...pressed,
      sequence: [...state.sequence, grown.pad],
      phase: "pre-show",
      phaseTicks: 0,
      showIndex: 0,
      inputIndex: 0,
      inputTicksLeft: 0,
      score: state.score + 1,
      rng: grown.rng,
    };
  },

  getScore(state: MemorySequenceState): number {
    return state.score;
  },

  isGameOver(state: MemorySequenceState): boolean {
    return state.over;
  },
};
