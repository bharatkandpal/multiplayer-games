// Drunk Walk character customization — mix-and-match parts (hat, beard,
// clothes color, shoe color) rather than a handful of fixed bundled "outfit"
// presets, opened from the cog menu (`DrunkWalkCustomizeMenu`) instead of the
// ready overlay. Purely cosmetic: none of this ever reaches the engine (no
// field on `DrunkWalkState`/`DrunkWalkInput`), so it can't affect physics,
// scoring, or the server-side re-simulation anti-cheat check (MPG-065) —
// `DrunkWalkScene` is the only thing that reads it.

export type DrunkWalkHat = "none" | "cap" | "party-hat" | "halo";
export type DrunkWalkBeard = "none" | "full" | "goatee" | "mustache";
export type DrunkWalkHair = "none" | "short" | "long" | "bun" | "mohawk";
export type DrunkWalkAccessory = "none" | "glasses" | "sunglasses" | "headphones";

export interface DrunkWalkCharacter {
  readonly hat: DrunkWalkHat;
  readonly beard: DrunkWalkBeard;
  readonly hair: DrunkWalkHair;
  readonly accessory: DrunkWalkAccessory;
  /** Id into `DRUNK_WALK_SKIN_TONES`. */
  readonly skinId: string;
  /** Id into `DRUNK_WALK_HAIR_COLORS`. Irrelevant while `hair === "none"`, but
   * always stored so a later hair pick doesn't need a separate default. */
  readonly hairColorId: string;
  /** Id into `DRUNK_WALK_CLOTHES_COLORS`. */
  readonly clothesId: string;
  /** Id into `DRUNK_WALK_SHOE_COLORS`. */
  readonly shoesId: string;
}

export interface DrunkWalkColorOption {
  readonly id: string;
  readonly name: string;
  readonly tone: string;
  readonly shade: string;
}

export interface DrunkWalkPartOption<T extends string> {
  readonly id: T;
  readonly name: string;
}

export const DRUNK_WALK_HATS: readonly DrunkWalkPartOption<DrunkWalkHat>[] = [
  { id: "none", name: "None" },
  { id: "cap", name: "Cap" },
  { id: "party-hat", name: "Party Hat" },
  { id: "halo", name: "Halo" },
] as const;

export const DRUNK_WALK_BEARDS: readonly DrunkWalkPartOption<DrunkWalkBeard>[] = [
  { id: "none", name: "None" },
  { id: "full", name: "Full Beard" },
  { id: "goatee", name: "Goatee" },
  { id: "mustache", name: "Mustache" },
] as const;

export const DRUNK_WALK_HAIRSTYLES: readonly DrunkWalkPartOption<DrunkWalkHair>[] = [
  { id: "none", name: "Bald" },
  { id: "short", name: "Short" },
  { id: "long", name: "Long" },
  { id: "bun", name: "Bun" },
  { id: "mohawk", name: "Mohawk" },
] as const;

export const DRUNK_WALK_ACCESSORIES: readonly DrunkWalkPartOption<DrunkWalkAccessory>[] = [
  { id: "none", name: "None" },
  { id: "glasses", name: "Glasses" },
  { id: "sunglasses", name: "Sunglasses" },
  { id: "headphones", name: "Headphones" },
] as const;

/** `"classic"` is special-cased in `DrunkWalkScene` to use the live theme's
 * `--color-warning` token instead of `tone`/`shade` here, so the default look
 * still respects light/dark mode; every other color is fixed regardless of
 * theme (a deliberate "costume", not a themed default). */
export const DRUNK_WALK_CLOTHES_COLORS: readonly DrunkWalkColorOption[] = [
  { id: "classic", name: "Classic", tone: "#ffd23f", shade: "#9a5b00" },
  { id: "blue", name: "Blue", tone: "#4fb0ff", shade: "#0a4a80" },
  { id: "pink", name: "Pink", tone: "#ff5fa2", shade: "#8a1450" },
  { id: "green", name: "Green", tone: "#5ee6a0", shade: "#106b3f" },
  { id: "purple", name: "Purple", tone: "#c88bff", shade: "#4a1d80" },
] as const;

export const DRUNK_WALK_SHOE_COLORS: readonly DrunkWalkColorOption[] = [
  { id: "black", name: "Black", tone: "#2b2b30", shade: "#141416" },
  { id: "red", name: "Red", tone: "#e0483f", shade: "#7a201a" },
  { id: "white", name: "White", tone: "#f2f2f2", shade: "#b8b8b8" },
  { id: "gold", name: "Gold", tone: "#e0b84a", shade: "#8a6a1a" },
] as const;

/** Skin tones for the head/hands — independent of clothes color (previously
 * the head just reused the clothes color, which meant re-skinning the
 * outfit re-skinned the person). A spread wide enough that, combined with
 * hair/accessories below, a player can approximate their own look or a
 * caricature of someone else without needing a photo pipeline. */
export const DRUNK_WALK_SKIN_TONES: readonly DrunkWalkColorOption[] = [
  { id: "fair", name: "Fair", tone: "#ffe0c2", shade: "#d9a876" },
  { id: "light", name: "Light", tone: "#f2c9a0", shade: "#c99566" },
  { id: "tan", name: "Tan", tone: "#c68642", shade: "#8f5a26" },
  { id: "brown", name: "Brown", tone: "#8d5524", shade: "#5c3413" },
  { id: "deep", name: "Deep", tone: "#5c3a21", shade: "#3a2213" },
] as const;

export const DRUNK_WALK_HAIR_COLORS: readonly DrunkWalkColorOption[] = [
  { id: "black", name: "Black", tone: "#2b2320", shade: "#17110f" },
  { id: "brown", name: "Brown", tone: "#6b4423", shade: "#402910" },
  { id: "blonde", name: "Blonde", tone: "#e8c873", shade: "#b89547" },
  { id: "red", name: "Red", tone: "#b5502f", shade: "#7a3319" },
  { id: "gray", name: "Gray", tone: "#b5b5ba", shade: "#85858c" },
  { id: "blue", name: "Blue", tone: "#6fa8ff", shade: "#2c5aa0" },
] as const;

export const DEFAULT_DRUNK_WALK_CHARACTER: DrunkWalkCharacter = {
  hat: "none",
  beard: "none",
  hair: "short",
  accessory: "none",
  skinId: "tan",
  hairColorId: "brown",
  clothesId: "classic",
  shoesId: "black",
};

function findColor(options: readonly DrunkWalkColorOption[], id: string): DrunkWalkColorOption {
  // Non-null: both color lists above are non-empty at compile time, and the
  // fallback to slot 0 covers any stored/unknown id (see `loadStoredDrunkWalkCharacter`).
  return options.find((o) => o.id === id) ?? options[0]!;
}

export function findClothesColor(id: string): DrunkWalkColorOption {
  return findColor(DRUNK_WALK_CLOTHES_COLORS, id);
}

export function findShoeColor(id: string): DrunkWalkColorOption {
  return findColor(DRUNK_WALK_SHOE_COLORS, id);
}

export function findSkinTone(id: string): DrunkWalkColorOption {
  return findColor(DRUNK_WALK_SKIN_TONES, id);
}

export function findHairColor(id: string): DrunkWalkColorOption {
  return findColor(DRUNK_WALK_HAIR_COLORS, id);
}

const CHARACTER_STORAGE_KEY = "mpg:drunk-walk:character";

function isValidCharacter(value: unknown): value is DrunkWalkCharacter {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    DRUNK_WALK_HATS.some((h) => h.id === v.hat) &&
    DRUNK_WALK_BEARDS.some((b) => b.id === v.beard) &&
    DRUNK_WALK_HAIRSTYLES.some((h) => h.id === v.hair) &&
    DRUNK_WALK_ACCESSORIES.some((a) => a.id === v.accessory) &&
    typeof v.skinId === "string" &&
    typeof v.hairColorId === "string" &&
    typeof v.clothesId === "string" &&
    typeof v.shoesId === "string"
  );
}

/** Best-effort read of the player's last-picked character. Falls back to the
 * default on any storage/parse failure (private browsing, disabled storage,
 * corrupt JSON, SSR) — customization is a nice-to-have, never worth breaking
 * the game over. */
export function loadStoredDrunkWalkCharacter(): DrunkWalkCharacter {
  try {
    const raw = window.localStorage.getItem(CHARACTER_STORAGE_KEY);
    if (!raw) return DEFAULT_DRUNK_WALK_CHARACTER;
    const parsed: unknown = JSON.parse(raw);
    return isValidCharacter(parsed) ? parsed : DEFAULT_DRUNK_WALK_CHARACTER;
  } catch {
    return DEFAULT_DRUNK_WALK_CHARACTER;
  }
}

/** Best-effort persistence of the player's character. Swallows storage
 * errors for the same reason as the loader above. */
export function storeDrunkWalkCharacter(character: DrunkWalkCharacter): void {
  try {
    window.localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(character));
  } catch {
    // Best-effort only — a failed write just means the pick won't persist.
  }
}
