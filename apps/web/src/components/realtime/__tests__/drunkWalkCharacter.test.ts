import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DRUNK_WALK_CHARACTER,
  DRUNK_WALK_COSMETICS,
  characterFromConfig,
  findClothesColor,
  findHairColor,
  findShoeColor,
  findSkinTone,
  loadStoredDrunkWalkCharacter,
  registerDrunkWalkCosmetics,
  storeDrunkWalkCharacter,
  type DrunkWalkCharacter,
} from "../drunkWalkCharacter";
import { clearCosmeticRegistry, getCosmeticSchema } from "../../../cosmetics";

/**
 * The pre-migration character, verbatim from what shipped. Every assertion
 * below is about NOT regressing this: MPG-088-b is a refactor onto the generic
 * layer, so identical defaults, identical colours, and identical stored data
 * are the whole acceptance bar.
 */
const LEGACY_DEFAULT: DrunkWalkCharacter = {
  hat: "none",
  beard: "none",
  hair: "short",
  accessory: "none",
  skinId: "tan",
  hairColorId: "brown",
  clothesId: "classic",
  shoesId: "black",
};

const LEGACY_STORAGE_KEY = "mpg:drunk-walk:character";
const NEW_STORAGE_KEY = "mpg:cosmetics:drunk-walk";

beforeEach(() => {
  window.localStorage.clear();
  clearCosmeticRegistry();
});

describe("Drunk Walk cosmetics — registration", () => {
  it("registers against the generic registry under its game id", () => {
    registerDrunkWalkCosmetics();
    expect(getCosmeticSchema("drunk-walk")).toBe(DRUNK_WALK_COSMETICS);
  });

  it("still offers exactly the eight shipped slots, in the shipped order", () => {
    expect(DRUNK_WALK_COSMETICS.slots.map((s) => s.id)).toEqual([
      "skinId",
      "hair",
      "hairColorId",
      "beard",
      "accessory",
      "hat",
      "clothesId",
      "shoesId",
    ]);
  });

  it("keeps every shipped option id in every slot", () => {
    const optionIds = Object.fromEntries(
      DRUNK_WALK_COSMETICS.slots.map((s) => [s.id, s.options.map((o) => o.id)]),
    );
    expect(optionIds).toEqual({
      skinId: ["fair", "light", "tan", "brown", "deep"],
      hair: ["none", "short", "long", "bun", "mohawk"],
      hairColorId: ["black", "brown", "blonde", "red", "gray", "blue"],
      beard: ["none", "full", "goatee", "mustache"],
      accessory: ["none", "glasses", "sunglasses", "headphones"],
      hat: ["none", "cap", "party-hat", "halo"],
      clothesId: ["classic", "blue", "pink", "green", "purple"],
      shoesId: ["black", "red", "white", "gold"],
    });
  });
});

describe("Drunk Walk cosmetics — no visual regression", () => {
  it("produces the same default character as before the migration", () => {
    expect(DEFAULT_DRUNK_WALK_CHARACTER).toEqual(LEGACY_DEFAULT);
  });

  it("resolves the same colours the renderers drew with before", () => {
    expect(findClothesColor("classic")).toEqual({
      id: "classic",
      name: "Classic",
      tone: "#ffd23f",
      shade: "#9a5b00",
    });
    expect(findShoeColor("gold")).toEqual({
      id: "gold",
      name: "Gold",
      tone: "#e0b84a",
      shade: "#8a6a1a",
    });
    expect(findSkinTone("deep")).toEqual({
      id: "deep",
      name: "Deep",
      tone: "#5c3a21",
      shade: "#3a2213",
    });
    expect(findHairColor("blonde")).toEqual({
      id: "blonde",
      name: "Blonde",
      tone: "#e8c873",
      shade: "#b89547",
    });
  });

  it("falls back to the slot default for an unknown colour id, as the old lookup did", () => {
    // Old behaviour was `options.find(...) ?? options[0]`; the generic resolver
    // uses the declared default, which for these slots IS the first option.
    expect(findClothesColor("chartreuse").id).toBe("classic");
    expect(findShoeColor("nope").id).toBe("black");
  });

  it("narrows a config into the typed view the renderers read", () => {
    expect(characterFromConfig({ ...LEGACY_DEFAULT, hat: "cap", clothesId: "pink" })).toEqual({
      ...LEGACY_DEFAULT,
      hat: "cap",
      clothesId: "pink",
    });
  });
});

describe("Drunk Walk cosmetics — stored characters are preserved", () => {
  it("migrates a pre-migration save onto the generic key and keeps every pick", () => {
    const saved: DrunkWalkCharacter = {
      hat: "party-hat",
      beard: "goatee",
      hair: "mohawk",
      accessory: "sunglasses",
      skinId: "deep",
      hairColorId: "blue",
      clothesId: "purple",
      shoesId: "gold",
    };
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(saved));

    expect(loadStoredDrunkWalkCharacter()).toEqual(saved);
    // Migrated once, then the old key is gone — not read again on next load.
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(NEW_STORAGE_KEY) ?? "{}")).toMatchObject(saved);
    expect(loadStoredDrunkWalkCharacter()).toEqual(saved);
  });

  it("repairs a legacy save holding an option that no longer exists", () => {
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({ ...LEGACY_DEFAULT, hat: "fedora" }),
    );
    // The retired pick resets to its default; everything else survives.
    expect(loadStoredDrunkWalkCharacter()).toEqual(LEGACY_DEFAULT);
  });

  it("falls back to defaults on a corrupt legacy save rather than throwing", () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "{not json");
    expect(loadStoredDrunkWalkCharacter()).toEqual(LEGACY_DEFAULT);
  });

  it("round-trips a character through the generic storage", () => {
    const picked: DrunkWalkCharacter = { ...LEGACY_DEFAULT, hair: "bun", shoesId: "red" };
    storeDrunkWalkCharacter(picked);
    expect(loadStoredDrunkWalkCharacter()).toEqual(picked);
  });

  it("returns the default character when nothing is stored", () => {
    expect(loadStoredDrunkWalkCharacter()).toEqual(LEGACY_DEFAULT);
  });
});
