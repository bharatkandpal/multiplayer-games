// THROWAWAY SPIKE (MPG-039) — not shipped. See docs/adr/0002-realtime-games.md.
//
// mulberry32: a tiny, fast, seeded PRNG. Used here to demonstrate the ADR's core
// determinism claim — realtime state carries its own RNG *state* (not Math.random),
// so `tick(state, input)` stays a pure, replayable function of (seed, input log).
// This keeps a future realtime engine module as pure as `packages/engine` is today.

export interface PrngState {
  /** 32-bit unsigned accumulator — the entire RNG state, carried inside game state. */
  readonly s: number;
}

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
