import { describe, expect, it } from "vitest";

import { maskProfanity } from "../profanityMask.js";

describe("maskProfanity", () => {
  it("masks a whole-word profanity match, case-insensitively", () => {
    expect(maskProfanity("that is Shit")).toBe("that is ****");
  });

  it("leaves clean text untouched", () => {
    expect(maskProfanity("hello there, good game")).toBe("hello there, good game");
  });

  it("does not touch an innocent word that merely contains a banned substring", () => {
    // Word-boundary matching (not the leetspeak/substring collapse moderate.ts
    // uses) — "classic" contains no banned word as a whole word, but a
    // dedicated substring like "assassin" containing "ass" is not on the list
    // at all, so this simply proves boundaries are respected.
    expect(maskProfanity("classic game")).toBe("classic game");
  });

  it("masks multiple occurrences", () => {
    expect(maskProfanity("fuck this fuck that")).toBe("**** this **** that");
  });
});
