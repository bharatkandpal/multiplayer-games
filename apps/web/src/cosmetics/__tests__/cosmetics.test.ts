import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearCosmeticRegistry,
  clearCosmetics,
  defaultConfig,
  getCosmeticSchema,
  hasCosmetics,
  listCosmeticGames,
  loadCosmetics,
  registerCosmetics,
  resolveOption,
  resolvePalette,
  storeCosmetics,
  type CosmeticSchema,
} from "..";

const schema: CosmeticSchema = {
  gameId: "test-game",
  slots: [
    {
      id: "hat",
      label: "Hat",
      kind: "part",
      options: [
        { id: "none", name: "None" },
        { id: "cap", name: "Cap" },
      ],
    },
    {
      id: "shirt",
      label: "Shirt",
      kind: "palette",
      defaultOptionId: "blue",
      options: [
        { id: "red", name: "Red", palette: { tone: "#f00", shade: "#900" } },
        { id: "blue", name: "Blue", palette: { tone: "#00f", shade: "#009" } },
      ],
    },
  ],
};

describe("cosmetic registry", () => {
  beforeEach(() => {
    clearCosmeticRegistry();
    window.localStorage.clear();
  });

  afterEach(() => {
    clearCosmeticRegistry();
    window.localStorage.clear();
  });

  it("registers and looks up a schema per game", () => {
    registerCosmetics(schema);
    expect(getCosmeticSchema("test-game")).toBe(schema);
    expect(hasCosmetics("test-game")).toBe(true);
    expect(listCosmeticGames()).toEqual(["test-game"]);
  });

  it("treats a game with no cosmetics as absent, not an error", () => {
    expect(getCosmeticSchema("nim")).toBeUndefined();
    expect(hasCosmetics("nim")).toBe(false);
  });

  it("rejects a duplicate registration rather than silently overwriting", () => {
    registerCosmetics(schema);
    expect(() => registerCosmetics(schema)).toThrow(/already registered/);
  });

  it.each([
    [
      "a slot with no options",
      { gameId: "bad", slots: [{ id: "hat", label: "Hat", kind: "part" as const, options: [] }] },
      /has no options/,
    ],
    [
      "duplicate slot ids",
      {
        gameId: "bad",
        slots: [
          { id: "hat", label: "Hat", kind: "part" as const, options: [{ id: "a", name: "A" }] },
          { id: "hat", label: "Hat", kind: "part" as const, options: [{ id: "b", name: "B" }] },
        ],
      },
      /Duplicate cosmetic slot/,
    ],
    [
      "a default naming an option that doesn't exist",
      {
        gameId: "bad",
        slots: [
          {
            id: "hat",
            label: "Hat",
            kind: "part" as const,
            defaultOptionId: "ghost",
            options: [{ id: "a", name: "A" }],
          },
        ],
      },
      /unknown option/,
    ],
  ])("rejects %s at registration time", (_label, bad, message) => {
    expect(() => registerCosmetics(bad as CosmeticSchema)).toThrow(message);
  });

  it("defaults to the declared default, else the first option", () => {
    expect(defaultConfig(schema)).toEqual({ hat: "none", shirt: "blue" });
  });

  it("resolves a chosen option and its palette", () => {
    expect(resolveOption(schema, { hat: "cap", shirt: "red" }, "hat")?.name).toBe("Cap");
    expect(resolvePalette(schema, { hat: "cap", shirt: "red" }, "shirt")).toEqual({
      tone: "#f00",
      shade: "#900",
    });
  });

  it("falls back to the default for a missing or retired option id", () => {
    // A palette dropped in a later release must not render as nothing.
    expect(resolveOption(schema, { shirt: "chartreuse" }, "shirt")?.id).toBe("blue");
    expect(resolveOption(schema, {}, "hat")?.id).toBe("none");
  });

  it("returns undefined for a slot the schema doesn't have (caller bug, not stale data)", () => {
    expect(resolveOption(schema, {}, "cape")).toBeUndefined();
  });
});

describe("cosmetic storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a config", () => {
    storeCosmetics("test-game", { hat: "cap", shirt: "red" });
    expect(loadCosmetics(schema)).toEqual({ hat: "cap", shirt: "red" });
  });

  it("namespaces per game so two games' picks can't collide", () => {
    storeCosmetics("test-game", { hat: "cap", shirt: "red" });
    storeCosmetics("other-game", { hat: "none", shirt: "blue" });
    expect(loadCosmetics(schema)).toEqual({ hat: "cap", shirt: "red" });
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadCosmetics(schema)).toEqual({ hat: "none", shirt: "blue" });
  });

  it("repairs a stored config that names options which no longer exist", () => {
    storeCosmetics("test-game", { hat: "sombrero", shirt: "red" });
    // The stale slot resets; the still-valid one is preserved.
    expect(loadCosmetics(schema)).toEqual({ hat: "none", shirt: "red" });
  });

  it("fills in a slot added after the config was saved", () => {
    window.localStorage.setItem("mpg:cosmetics:test-game", JSON.stringify({ hat: "cap" }));
    expect(loadCosmetics(schema)).toEqual({ hat: "cap", shirt: "blue" });
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["a non-object", "42"],
    ["an array", "[1,2]"],
  ])("falls back to defaults on %s rather than throwing", (_label, raw) => {
    window.localStorage.setItem("mpg:cosmetics:test-game", raw);
    expect(loadCosmetics(schema)).toEqual({ hat: "none", shirt: "blue" });
  });

  it("survives storage being unavailable entirely", () => {
    const getItem = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("SecurityError");
    };
    try {
      expect(loadCosmetics(schema)).toEqual({ hat: "none", shirt: "blue" });
      expect(() => storeCosmetics("test-game", { hat: "cap" })).not.toThrow();
    } finally {
      window.localStorage.getItem = getItem;
    }
  });

  it("clears a game's saved cosmetics", () => {
    storeCosmetics("test-game", { hat: "cap", shirt: "red" });
    clearCosmetics("test-game");
    expect(loadCosmetics(schema)).toEqual({ hat: "none", shirt: "blue" });
  });
});
