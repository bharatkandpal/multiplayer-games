/**
 * The test that both font bugs would have failed.
 *
 * `GET /api/cards/:token.png` shipped twice with a font configuration resvg
 * ignored, and both times it returned a perfectly valid 1200×630 PNG with every
 * glyph missing. `cardRoutes.test.ts` passed throughout — it asserts status and
 * `content-type`, which a blank card satisfies. So this file asserts the one
 * thing that actually separates a working card from a broken one: **there is
 * text ink on it.**
 *
 * Deliberately a property of the pixels, not a byte count or an image snapshot.
 * Sizes and layout move whenever the card design does; "did any glyphs get
 * drawn" does not.
 */

import { describe, expect, it } from "vitest";

import type { ResultCardInput } from "../index.js";
import { renderResultCardImage, renderResultCardPng } from "../raster.js";

const RESULT = {
  gameId: "connect4",
  gameFamily: "turn-based",
  status: "win",
  score: null,
  winnerSlot: 1,
  seatsSnapshot: [
    { kind: "human", slot: 1 },
    { kind: "bot", slot: 2, difficulty: "easy" },
  ],
  durationMs: 4200,
  createdAt: new Date("2026-09-20T04:52:22.061Z"),
} as unknown as ResultCardInput;

/** PNG signature, so "we got an image at all" fails separately from "it's blank". */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * Fraction of opaque pixels dark enough to be glyph ink. The card is a pale
 * background with near-black type, so a rendered card lands well above the
 * threshold below while a text-free one sits near zero — the magenta accent
 * rule is a few hundred pixels and is not dark enough to count.
 */
function inkRatio(): number {
  const { pixels, width, height } = renderResultCardImage(RESULT);
  let dark = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i]! < 100 && pixels[i + 1]! < 100 && pixels[i + 2]! < 100 && pixels[i + 3]! > 128) {
      dark += 1;
    }
  }
  return dark / (width * height);
}

describe("renderResultCardPng", () => {
  it("produces a 1200x630 PNG", () => {
    const png = renderResultCardPng(RESULT);
    const { width, height } = renderResultCardImage(RESULT);
    expect(png.subarray(0, 4)).toEqual(PNG_MAGIC);
    expect([width, height]).toEqual([1200, 630]);
  });

  it("draws text — the blank-card regression (MPG-148)", () => {
    // A blank card measured ~0.0003 (the accent rule alone); a correctly
    // rendered one measures ~0.02. Two orders of magnitude of daylight, so the
    // threshold does not need to track the design.
    expect(inkRatio()).toBeGreaterThan(0.005);
  });

  it("is deterministic, which is what makes the immutable cache sound", () => {
    expect(renderResultCardPng(RESULT).equals(renderResultCardPng(RESULT))).toBe(true);
  });
});
