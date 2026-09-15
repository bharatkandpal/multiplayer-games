import { describe, it, expect } from "vitest";

import { MAX_COSMETIC_ID_LEN, MAX_COSMETIC_SLOTS, validateCosmetics } from "../cosmetics.js";

describe("validateCosmetics", () => {
  it("accepts a flat string→string map and narrows it", () => {
    const result = validateCosmetics({ theme: "neon", piece: "orb" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cosmetics).toEqual({ theme: "neon", piece: "orb" });
  });

  it("accepts an empty map (defaults, saved and named)", () => {
    const result = validateCosmetics({});
    expect(result).toEqual({ ok: true, cosmetics: {} });
  });

  it("accepts exactly the slot cap and rejects one over", () => {
    const atCap: Record<string, string> = {};
    for (let i = 0; i < MAX_COSMETIC_SLOTS; i++) atCap[`slot${i}`] = "x";
    expect(validateCosmetics(atCap).ok).toBe(true);

    const overCap: Record<string, string> = { ...atCap, oneMore: "x" };
    expect(validateCosmetics(overCap)).toEqual({
      ok: false,
      reason: "cosmetics_too_many_slots",
    });
  });

  it("accepts keys/values at the length cap and rejects one over", () => {
    const maxId = "k".repeat(MAX_COSMETIC_ID_LEN);
    expect(validateCosmetics({ [maxId]: maxId }).ok).toBe(true);

    const overKey = "k".repeat(MAX_COSMETIC_ID_LEN + 1);
    expect(validateCosmetics({ [overKey]: "v" })).toEqual({
      ok: false,
      reason: "cosmetics_key_length",
    });

    const overVal = "v".repeat(MAX_COSMETIC_ID_LEN + 1);
    expect(validateCosmetics({ k: overVal })).toEqual({
      ok: false,
      reason: "cosmetics_value_length",
    });
  });

  it("rejects empty keys and empty values", () => {
    expect(validateCosmetics({ "": "v" })).toEqual({ ok: false, reason: "cosmetics_key_length" });
    expect(validateCosmetics({ k: "" })).toEqual({ ok: false, reason: "cosmetics_value_length" });
  });

  it("rejects non-string values (no nesting, no numbers, no arrays)", () => {
    expect(validateCosmetics({ k: 1 })).toEqual({
      ok: false,
      reason: "cosmetics_value_not_string",
    });
    expect(validateCosmetics({ k: { nested: "x" } })).toEqual({
      ok: false,
      reason: "cosmetics_value_not_string",
    });
    expect(validateCosmetics({ k: ["x"] })).toEqual({
      ok: false,
      reason: "cosmetics_value_not_string",
    });
    expect(validateCosmetics({ k: null })).toEqual({
      ok: false,
      reason: "cosmetics_value_not_string",
    });
  });

  it("rejects non-object inputs (null, array, primitive)", () => {
    expect(validateCosmetics(null)).toEqual({ ok: false, reason: "cosmetics_not_object" });
    expect(validateCosmetics([])).toEqual({ ok: false, reason: "cosmetics_not_object" });
    expect(validateCosmetics("theme=neon")).toEqual({ ok: false, reason: "cosmetics_not_object" });
    expect(validateCosmetics(42)).toEqual({ ok: false, reason: "cosmetics_not_object" });
    expect(validateCosmetics(undefined)).toEqual({ ok: false, reason: "cosmetics_not_object" });
  });
});
