// mulberry32 — a tiny, fast, seeded PRNG for the real-time game family (ADR 0002).
//
// Real-time modules must be pure (no `Math.random`), so each run carries its own RNG
// *state* inside the game state and advances it purely via `tick`. That makes a run a
// deterministic, replayable function of (seed, input log) — unit-testable with no
// timers/DOM, and re-simulatable server-side to validate a submitted score. This is
// the real-time analogue of the turn-based rule "randomness lives in an injected RNG,
// never in the rules". Shared across realtime games (floppy-birds, lumberjack, …).

export interface PrngState {
  /** 32-bit unsigned accumulator — the entire RNG state, carried inside game state. */
  readonly s: number;
}

/** Seeds a PRNG from any number (coerced to a 32-bit unsigned integer). */
export function seedPrng(seed: number): PrngState {
  return { s: seed >>> 0 };
}

/** Returns the next float in [0, 1) AND the advanced PRNG state. Pure. */
export function nextFloat(state: PrngState): { value: number; next: PrngState } {
  const a = (state.s + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next: { s: a } };
}
