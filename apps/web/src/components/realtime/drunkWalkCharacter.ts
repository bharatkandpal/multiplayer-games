// Drunk Walk character customization, expressed as a registration against the
// generic cosmetic layer (MPG-088-b) rather than as its own bespoke types +
// storage. The parts and colours are unchanged — this is the same eight
// mix-and-match slots (hat, beard, hair, accessory, and four palettes) that
// shipped before; what changed is that the platform now owns the schema,
// defaults, validation, resolution and persistence, and this file is just the
// data plus a typed view of it.
//
// Still purely cosmetic: none of this reaches the engine (no field on
// `DrunkWalkState`/`DrunkWalkInput`), so it cannot affect physics, scoring, or
// the server-side re-simulation anti-cheat check (MPG-065). That is now
// enforced rather than asserted — see `cosmetics/__tests__/cosmetics.invariant.test.ts`.

import {
  defaultConfig,
  loadCosmetics,
  registerCosmetics,
  resolveOption,
  storeCosmetics,
  type CosmeticConfig,
  type CosmeticOption,
  type CosmeticSchema,
} from "../../cosmetics";

export type DrunkWalkHat = "none" | "cap" | "party-hat" | "halo";
export type DrunkWalkBeard = "none" | "full" | "goatee" | "mustache";
export type DrunkWalkHair = "none" | "short" | "long" | "bun" | "mohawk";
export type DrunkWalkAccessory = "none" | "glasses" | "sunglasses" | "headphones";

/**
 * The typed view the two renderers read. Structurally a `CosmeticConfig` whose
 * slot ids happen to be these field names — which is exactly why the slot ids
 * below were chosen to match: a stored character from before this migration is
 * already a valid config, so old saves carry over with no rewriting.
 */
export interface DrunkWalkCharacter {
  readonly hat: DrunkWalkHat;
  readonly beard: DrunkWalkBeard;
  readonly hair: DrunkWalkHair;
  readonly accessory: DrunkWalkAccessory;
  /** Id into the `skinId` slot. */
  readonly skinId: string;
  /** Id into the `hairColorId` slot. Irrelevant while `hair === "none"`, but
   * always resolved so a later hair pick doesn't need a separate default. */
  readonly hairColorId: string;
  /** Id into the `clothesId` slot. */
  readonly clothesId: string;
  /** Id into the `shoesId` slot. */
  readonly shoesId: string;
}

/** What the renderers want from a palette slot: the swatch plus its identity. */
export interface DrunkWalkColorOption {
  readonly id: string;
  readonly name: string;
  readonly tone: string;
  readonly shade: string;
}

/** `"classic"` is special-cased by both renderers to use the live theme's
 * `--color-warning` token instead of the `tone`/`shade` here, so the default
 * look still respects light/dark mode; every other colour is fixed regardless
 * of theme (a deliberate "costume", not a themed default). */
export const DRUNK_WALK_COSMETICS: CosmeticSchema = {
  gameId: "drunk-walk",
  slots: [
    {
      id: "skinId",
      label: "Skin tone",
      kind: "palette",
      defaultOptionId: "tan",
      // A spread wide enough that, combined with hair and accessories, a player
      // can approximate their own look or a caricature of someone else's
      // without needing a photo pipeline.
      options: [
        { id: "fair", name: "Fair", palette: { tone: "#ffe0c2", shade: "#d9a876" } },
        { id: "light", name: "Light", palette: { tone: "#f2c9a0", shade: "#c99566" } },
        { id: "tan", name: "Tan", palette: { tone: "#c68642", shade: "#8f5a26" } },
        { id: "brown", name: "Brown", palette: { tone: "#8d5524", shade: "#5c3413" } },
        { id: "deep", name: "Deep", palette: { tone: "#5c3a21", shade: "#3a2213" } },
      ],
    },
    {
      id: "hair",
      label: "Hair",
      kind: "part",
      defaultOptionId: "short",
      options: [
        { id: "none", name: "Bald" },
        { id: "short", name: "Short" },
        { id: "long", name: "Long" },
        { id: "bun", name: "Bun" },
        { id: "mohawk", name: "Mohawk" },
      ],
    },
    {
      id: "hairColorId",
      label: "Hair color",
      kind: "palette",
      defaultOptionId: "brown",
      options: [
        { id: "black", name: "Black", palette: { tone: "#2b2320", shade: "#17110f" } },
        { id: "brown", name: "Brown", palette: { tone: "#6b4423", shade: "#402910" } },
        { id: "blonde", name: "Blonde", palette: { tone: "#e8c873", shade: "#b89547" } },
        { id: "red", name: "Red", palette: { tone: "#b5502f", shade: "#7a3319" } },
        { id: "gray", name: "Gray", palette: { tone: "#b5b5ba", shade: "#85858c" } },
        { id: "blue", name: "Blue", palette: { tone: "#6fa8ff", shade: "#2c5aa0" } },
      ],
    },
    {
      id: "beard",
      label: "Beard",
      kind: "part",
      options: [
        { id: "none", name: "None" },
        { id: "full", name: "Full Beard" },
        { id: "goatee", name: "Goatee" },
        { id: "mustache", name: "Mustache" },
      ],
    },
    {
      id: "accessory",
      label: "Accessory",
      kind: "part",
      options: [
        { id: "none", name: "None" },
        { id: "glasses", name: "Glasses" },
        { id: "sunglasses", name: "Sunglasses" },
        { id: "headphones", name: "Headphones" },
      ],
    },
    {
      id: "hat",
      label: "Hat",
      kind: "part",
      options: [
        { id: "none", name: "None" },
        { id: "cap", name: "Cap" },
        { id: "party-hat", name: "Party Hat" },
        { id: "halo", name: "Halo" },
      ],
    },
    {
      id: "clothesId",
      label: "Clothes",
      kind: "palette",
      defaultOptionId: "classic",
      options: [
        { id: "classic", name: "Classic", palette: { tone: "#ffd23f", shade: "#9a5b00" } },
        { id: "blue", name: "Blue", palette: { tone: "#4fb0ff", shade: "#0a4a80" } },
        { id: "pink", name: "Pink", palette: { tone: "#ff5fa2", shade: "#8a1450" } },
        { id: "green", name: "Green", palette: { tone: "#5ee6a0", shade: "#106b3f" } },
        { id: "purple", name: "Purple", palette: { tone: "#c88bff", shade: "#4a1d80" } },
      ],
    },
    {
      id: "shoesId",
      label: "Shoes",
      kind: "palette",
      defaultOptionId: "black",
      options: [
        { id: "black", name: "Black", palette: { tone: "#2b2b30", shade: "#141416" } },
        { id: "red", name: "Red", palette: { tone: "#e0483f", shade: "#7a201a" } },
        { id: "white", name: "White", palette: { tone: "#f2f2f2", shade: "#b8b8b8" } },
        { id: "gold", name: "Gold", palette: { tone: "#e0b84a", shade: "#8a6a1a" } },
      ],
    },
  ],
};

/** Registers Drunk Walk's cosmetics. Called once at startup, next to the
 * engine's own `registerBuiltIn*` calls. */
export function registerDrunkWalkCosmetics(): void {
  registerCosmetics(DRUNK_WALK_COSMETICS);
}

export const DEFAULT_DRUNK_WALK_CHARACTER = defaultConfig(
  DRUNK_WALK_COSMETICS,
) as unknown as DrunkWalkCharacter;

/**
 * Narrows a generic config into the renderers' typed view.
 *
 * The cast is sound because `resolveOption` guarantees the returned id is one
 * the schema declares — an unknown or retired id resolves to the slot default
 * — so every field is a real member of its union by construction.
 */
export function characterFromConfig(config: CosmeticConfig): DrunkWalkCharacter {
  const pick = (slotId: string): string =>
    resolveOption(DRUNK_WALK_COSMETICS, config, slotId)?.id ?? "none";
  return {
    hat: pick("hat") as DrunkWalkHat,
    beard: pick("beard") as DrunkWalkBeard,
    hair: pick("hair") as DrunkWalkHair,
    accessory: pick("accessory") as DrunkWalkAccessory,
    skinId: pick("skinId"),
    hairColorId: pick("hairColorId"),
    clothesId: pick("clothesId"),
    shoesId: pick("shoesId"),
  };
}

/** Flattens a palette slot's chosen option into the `{id,name,tone,shade}` the
 * two renderers already draw with. */
function colorFor(slotId: string, optionId: string): DrunkWalkColorOption {
  const option = resolveOption(DRUNK_WALK_COSMETICS, { [slotId]: optionId }, slotId);
  // Non-null: every slot id passed here is declared above, and `resolveOption`
  // falls back to the slot default for an unknown option id.
  const resolved = option as CosmeticOption;
  return {
    id: resolved.id,
    name: resolved.name,
    tone: resolved.palette?.tone ?? "#000000",
    shade: resolved.palette?.shade ?? "#000000",
  };
}

export function findClothesColor(id: string): DrunkWalkColorOption {
  return colorFor("clothesId", id);
}

export function findShoeColor(id: string): DrunkWalkColorOption {
  return colorFor("shoesId", id);
}

export function findSkinTone(id: string): DrunkWalkColorOption {
  return colorFor("skinId", id);
}

export function findHairColor(id: string): DrunkWalkColorOption {
  return colorFor("hairColorId", id);
}

/**
 * Where characters were stored before this migration. The old value's keys are
 * the new slot ids (that is why the ids above were chosen to match), so a
 * legacy save is already a valid config and reconciling it is the whole
 * migration — no field mapping, no version stamp.
 */
const LEGACY_STORAGE_KEY = "mpg:drunk-walk:character";

/**
 * Moves a pre-MPG-088-b save onto the generic key, once. Best-effort like
 * everything else in this path: if storage is unavailable the player just gets
 * defaults, which is the same outcome they'd have had if the read failed.
 */
function migrateLegacyCharacter(): void {
  try {
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return;
    const parsed: unknown = JSON.parse(legacy);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      storeCosmetics(DRUNK_WALK_COSMETICS.gameId, parsed as CosmeticConfig);
    }
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Nothing to do — the load below falls back to defaults.
  }
}

/** The player's stored character, migrating a legacy save on first read. */
export function loadStoredDrunkWalkCharacter(): DrunkWalkCharacter {
  try {
    if (window.localStorage.getItem(LEGACY_STORAGE_KEY) !== null) {
      migrateLegacyCharacter();
    }
  } catch {
    // Storage unavailable — `loadCosmetics` degrades to defaults below.
  }
  return characterFromConfig(loadCosmetics(DRUNK_WALK_COSMETICS));
}

/** Persists the player's character through the generic cosmetic storage. */
export function storeDrunkWalkCharacter(character: DrunkWalkCharacter): void {
  storeCosmetics(DRUNK_WALK_COSMETICS.gameId, character as unknown as CosmeticConfig);
}
