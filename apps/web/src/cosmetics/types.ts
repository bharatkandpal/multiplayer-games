/**
 * The generic cosmetic layer (MPG-088-a, "L1") — a game-agnostic way to
 * describe what a player can customize, generalized from the shipped Drunk Walk
 * character (hat / beard / hair / accessory + four colour palettes).
 *
 * # The invariant this layer exists to protect
 *
 * Cosmetics are **renderer-only**. Nothing here may ever reach a `GameModule`
 * or `RealtimeModule`: not their state, not their input, not their tick. That
 * is not a style preference — it is what keeps a hat from changing physics or
 * scoring, and it is what keeps the server's re-simulation anti-cheat check
 * (MPG-065) sound, since the server replays `{seed, inputLog}` with no idea
 * what the player was wearing. `cosmetics.invariant.test.ts` fails the build if
 * the engine package so much as mentions cosmetics.
 *
 * This is why the whole layer lives in `apps/web` rather than
 * `packages/engine`: the engine cannot depend on something it must not know
 * about, and putting cosmetics next to it would make the violation a one-line
 * import away.
 *
 * # Shape
 *
 * A schema is a list of slots; a slot is a labelled choice between named
 * options; a config is just `slot id → option id`. That flat, stringly-keyed
 * config is deliberate — it survives JSON round-tripping unchanged, so the same
 * value works for localStorage today and a server-side variant record later
 * (MPG-089) with no translation layer.
 */

/** The two-tone swatch a renderer draws a coloured part with. */
export interface CosmeticPalette {
  /** The main fill. */
  readonly tone: string;
  /** The darker edge/shadow companion to `tone`. */
  readonly shade: string;
}

export interface CosmeticOption {
  readonly id: string;
  /** Human-readable, shown in the picker. */
  readonly name: string;
  /**
   * Present on `palette` slots, absent on `part` slots. A renderer reads this
   * for colour; the platform never interprets it.
   */
  readonly palette?: CosmeticPalette;
}

/**
 * `part` = which shape is drawn (hat, hairstyle…). `palette` = what colour
 * something is drawn in. The platform treats both identically — the distinction
 * exists so a picker can render swatches for one and labels for the other.
 */
export type CosmeticSlotKind = "part" | "palette";

export interface CosmeticSlot {
  readonly id: string;
  /** Human-readable, shown as the group label in the picker. */
  readonly label: string;
  readonly kind: CosmeticSlotKind;
  readonly options: readonly CosmeticOption[];
  /** Defaults to the first option when omitted. */
  readonly defaultOptionId?: string;
}

export interface CosmeticSchema {
  /**
   * The game this schema customizes. A plain string, not `GameId`, so the
   * layer works for turn-based and real-time games alike (MPG-088-c) without
   * importing either registry's id union.
   */
  readonly gameId: string;
  readonly slots: readonly CosmeticSlot[];
}

/**
 * A player's picks: `slot id → option id`. Partial and unvalidated by
 * construction — read it through `resolveOption`/`resolvePalette`, which fall
 * back to the slot default, so an unknown or stale id can never render nothing.
 */
export type CosmeticConfig = Readonly<Record<string, string>>;
