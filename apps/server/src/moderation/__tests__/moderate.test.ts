import { describe, expect, it } from "vitest";

import { moderateText } from "../moderate.js";

describe("moderateText", () => {
  describe("handle", () => {
    it("accepts a clean handle and returns it trimmed", () => {
      expect(moderateText("handle", "  bharat_k  ")).toEqual({ ok: true, value: "bharat_k" });
    });

    it("rejects non-string input as EMPTY", () => {
      expect(moderateText("handle", undefined)).toEqual({ ok: false, reason: "EMPTY" });
      expect(moderateText("handle", 42)).toEqual({ ok: false, reason: "EMPTY" });
      expect(moderateText("handle", null)).toEqual({ ok: false, reason: "EMPTY" });
    });

    it("rejects blank / whitespace as EMPTY", () => {
      expect(moderateText("handle", "   ")).toEqual({ ok: false, reason: "EMPTY" });
    });

    it("enforces the length caps", () => {
      expect(moderateText("handle", "ab")).toEqual({ ok: false, reason: "TOO_SHORT" });
      expect(moderateText("handle", "a".repeat(21))).toEqual({ ok: false, reason: "TOO_LONG" });
    });

    it("rejects disallowed characters", () => {
      expect(moderateText("handle", "bad name")).toEqual({ ok: false, reason: "INVALID_CHARS" });
      expect(moderateText("handle", "nope!")).toEqual({ ok: false, reason: "INVALID_CHARS" });
    });

    it("blocks profanity, including leetspeak and separator obfuscation", () => {
      for (const bad of ["shithead", "Sh1thead", "f_u_c_k", "b1tch", "a55hole"]) {
        expect(moderateText("handle", bad), bad).toEqual({ ok: false, reason: "PROFANITY" });
      }
    });

    it("blocks impersonation of reserved roles, with digits/separators stripped", () => {
      for (const bad of [
        "admin",
        "Admin",
        "admin123",
        "a-d-m-i-n",
        "official",
        "mpg",
        "moderator",
      ]) {
        expect(moderateText("handle", bad), bad).toEqual({ ok: false, reason: "RESERVED" });
      }
    });

    it("does not over-block: a reserved substring inside a longer word is fine", () => {
      // "administrating" collapses to itself, not equal to "admin" → allowed.
      expect(moderateText("handle", "administrating")).toEqual({
        ok: true,
        value: "administrating",
      });
    });
  });

  describe("variant_name", () => {
    it("allows spaces and light punctuation and a single character", () => {
      expect(moderateText("variant_name", "Bharat's Hard Mode!")).toEqual({
        ok: true,
        value: "Bharat's Hard Mode!",
      });
      expect(moderateText("variant_name", "x")).toEqual({ ok: true, value: "x" });
    });

    it("caps length at 40", () => {
      expect(moderateText("variant_name", "a".repeat(41))).toEqual({
        ok: false,
        reason: "TOO_LONG",
      });
    });

    it("still blocks profanity", () => {
      expect(moderateText("variant_name", "the shit level")).toEqual({
        ok: false,
        reason: "PROFANITY",
      });
    });

    it("does not impersonation-check display names", () => {
      // "admin" is a fine level name — you cannot impersonate staff with one.
      expect(moderateText("variant_name", "admin")).toEqual({ ok: true, value: "admin" });
    });
  });
});
