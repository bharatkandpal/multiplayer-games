// Real-time arcade game family (ADR 0002 — docs/adr/0002-realtime-games.md).
//
// `RealtimeModule<S, I>` is a SIBLING of `GameModule<S, M, Line>`, not a subtype:
// the two families share almost nothing at the rules layer (no seats, no turn
// order, no legal-move enumeration, no minimax), so they are peers that coexist by
// unifying only the thin "pick a game" catalog above them. Nothing here touches the
// turn-based interface, registry, or ids.
//
// Like `GameModule`, implementations MUST be pure: no `requestAnimationFrame`, no
// `Date.now()`, no `Math.random()`. The wall clock, the rAF loop, DOM input sampling
// and rendering all live in the web controller. ALL randomness derives from the seed
// and is carried inside the state `S`, advanced purely by `tick` — giving
// deterministic, replayable runs that are unit-testable with no timers/DOM/fakes.

/**
 * Known real-time games. Closed union today, mirroring {@link GameId}; widens to an
 * open `string` behind the registry when games become installable plugins (MPG-031).
 * `floppy-birds` lands with MPG-040; `drunk-walk` with MPG-076; `lumberjack` with MPG-041;
 * `2048` with MPG-074; `breakout` with MPG-075. `2048@3` / `2048@5` are the 3×3 /
 * 5×5 grid-size variants of 2048 (MPG-096) — separate ids so they rank on separate
 * leaderboards (ADR 0007 §5); the catalog still shows one "2048" card. `snake` lands
 * with MPG-140, `memory-sequence` with MPG-141, and `aim-trainer` with MPG-142.
 */
export type RealtimeGameId =
  | "floppy-birds"
  | "drunk-walk"
  | "lumberjack"
  | "reflex-test"
  | "2048"
  | "2048@3"
  | "2048@5"
  | "breakout"
  | "snake"
  | "memory-sequence"
  | "aim-trainer";

/**
 * The one interface every real-time game implements — the arcade counterpart to
 * {@link GameModule}. Solo by construction: no seats, no `playerCount`, no
 * `evaluate`/minimax, no `legalMoves`. Rendering is deliberately NOT here (the web
 * layer owns drawing, keyed by id), keeping the engine renderer-agnostic.
 *
 * @typeParam S - the game's state shape (opaque, serializable; carries the seeded RNG)
 * @typeParam I - the per-tick input sample (module-defined, e.g. `{ flap: boolean }`)
 */
export interface RealtimeModule<S, I> {
  /** Stable identifier used by the sibling realtime registry and the UI. */
  readonly id: RealtimeGameId;

  /** Discriminates this family from `GameModule` (which the catalog tags "turn-based"). */
  readonly kind: "realtime";

  /**
   * Fixed simulation rate. The controller accumulates real elapsed time and consumes
   * it in whole ticks at this Hz, so the sim is frame-rate independent and, given a
   * seed + input-per-tick sequence, fully reproducible.
   */
  readonly tickHz: number;

  /**
   * A fresh starting state from `seed`. All randomness derives from `seed` and is
   * carried inside `S` (a small seeded PRNG advanced purely by {@link tick}).
   */
  createInitialState(seed: number): S;

  /** Advance the sim by exactly one fixed tick. Pure: `(state, input) -> state`. */
  tick(state: S, input: I): S;

  /** The current run score. */
  getScore(state: S): number;

  /** Whether the run has ended (the score is final once this is true). */
  isGameOver(state: S): boolean;
}
