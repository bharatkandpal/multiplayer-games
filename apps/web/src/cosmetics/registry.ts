/**
 * Per-game cosmetic registration — the sibling of the engine's game registries,
 * kept on the client side of the boundary (see `types.ts` for why).
 *
 * A game opts in by registering a schema; games with nothing to customize
 * simply never appear here, and every consumer treats "no schema" as "no
 * customization UI", never as an error.
 */

import type {
  CosmeticConfig,
  CosmeticOption,
  CosmeticPalette,
  CosmeticSchema,
  CosmeticSlot,
} from "./types";

const registry = new Map<string, CosmeticSchema>();

/**
 * Rejects schemas that would make the resolvers below unsound — an empty slot
 * has no default to fall back to, and duplicate ids make "the option with this
 * id" ambiguous. Cheap to check once at registration; impossible to debug if it
 * slips through to a renderer.
 */
function validateSchema(schema: CosmeticSchema): void {
  const seenSlots = new Set<string>();
  for (const slot of schema.slots) {
    if (seenSlots.has(slot.id)) {
      throw new Error(`Duplicate cosmetic slot "${slot.id}" in schema: ${schema.gameId}`);
    }
    seenSlots.add(slot.id);

    if (slot.options.length === 0) {
      throw new Error(`Cosmetic slot "${slot.id}" has no options in schema: ${schema.gameId}`);
    }
    const seenOptions = new Set<string>();
    for (const option of slot.options) {
      if (seenOptions.has(option.id)) {
        throw new Error(
          `Duplicate option "${option.id}" in slot "${slot.id}" of schema: ${schema.gameId}`,
        );
      }
      seenOptions.add(option.id);
    }
    if (slot.defaultOptionId !== undefined && !seenOptions.has(slot.defaultOptionId)) {
      throw new Error(
        `Slot "${slot.id}" defaults to unknown option "${slot.defaultOptionId}" in schema: ${schema.gameId}`,
      );
    }
  }
}

/** Registers a game's cosmetic schema. Throws on a duplicate id — a silent
 * overwrite would mean two renderers disagreeing about the same slots. */
export function registerCosmetics(schema: CosmeticSchema): void {
  if (registry.has(schema.gameId)) {
    throw new Error(`Cosmetic schema already registered: ${schema.gameId}`);
  }
  validateSchema(schema);
  registry.set(schema.gameId, schema);
}

/** The schema for `gameId`, or `undefined` if the game has no cosmetics. */
export function getCosmeticSchema(gameId: string): CosmeticSchema | undefined {
  return registry.get(gameId);
}

export function hasCosmetics(gameId: string): boolean {
  return registry.has(gameId);
}

/** Ids of every game with a registered schema. */
export function listCosmeticGames(): string[] {
  return [...registry.keys()];
}

/** Removes all registrations. Intended for tests. */
export function clearCosmeticRegistry(): void {
  registry.clear();
}

/** The option a slot falls back to: its declared default, else its first. */
export function defaultOption(slot: CosmeticSlot): CosmeticOption {
  const declared = slot.options.find((o) => o.id === slot.defaultOptionId);
  // Non-null: a slot with no options is rejected at registration time by
  // `validateSchema` below, so there is always a first option to fall back to.
  return declared ?? slot.options[0]!;
}

/** The config a player starts from — every slot at its default. */
export function defaultConfig(schema: CosmeticSchema): CosmeticConfig {
  const config: Record<string, string> = {};
  for (const slot of schema.slots) {
    config[slot.id] = defaultOption(slot).id;
  }
  return config;
}

/**
 * The option currently chosen for `slotId`. Falls back to the slot's default
 * whenever the config is missing the slot or names an option that no longer
 * exists — so shipping a new palette, or dropping an old one, can never leave a
 * previously-saved character rendering as a blank.
 *
 * Returns `undefined` only when the slot itself isn't in the schema, which is a
 * caller bug rather than stale data.
 */
export function resolveOption(
  schema: CosmeticSchema,
  config: CosmeticConfig,
  slotId: string,
): CosmeticOption | undefined {
  const slot = schema.slots.find((s) => s.id === slotId);
  if (!slot) return undefined;
  const chosenId = config[slotId];
  return slot.options.find((o) => o.id === chosenId) ?? defaultOption(slot);
}

/** `resolveOption`'s palette, for the colour slots a renderer draws with. */
export function resolvePalette(
  schema: CosmeticSchema,
  config: CosmeticConfig,
  slotId: string,
): CosmeticPalette | undefined {
  return resolveOption(schema, config, slotId)?.palette;
}
