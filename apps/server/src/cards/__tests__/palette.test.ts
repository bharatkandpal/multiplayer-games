import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CABINET, DRUNK_WALK, TABLE } from "../palette.js";

/**
 * The card palette is hand-copied from `tokens.css` because the server can't import
 * across the FE/BE boundary and a rasterised PNG has no CSS cascade to resolve `var()`
 * against. These tests are what stop the copy from quietly drifting: they parse the
 * real stylesheet and compare. Change a token, and this goes red in CI rather than
 * showing up as an off-brand card in someone's Slack months later.
 */

const TOKENS_PATH = fileURLToPath(
  new URL("../../../../web/src/styles/tokens.css", import.meta.url),
);

const css = readFileSync(TOKENS_PATH, "utf8");

/**
 * Reads a custom property's value. `theme: "dark"` reads the value inside the
 * `:root[data-theme="dark"]` block; otherwise the first (light/root) declaration wins.
 */
function token(name: string, theme: "light" | "dark" = "light"): string {
  const source =
    theme === "dark" ? (/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "") : css;
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(source);
  if (!match) throw new Error(`token not found: ${name} (${theme})`);
  return match[1]!.trim();
}

describe("card palette mirrors tokens.css", () => {
  it("cabinet ground matches the real tokens", () => {
    expect(CABINET.bg).toBe(token("--color-cabinet"));
    expect(CABINET.panel).toBe(token("--color-cabinet-raised"));
    expect(CABINET.line).toBe(token("--color-cabinet-line"));
    expect(CABINET.ink).toBe(token("--color-on-cabinet"));
    // The cabinet is dark in both themes, so its ink borrows the DARK theme ramp.
    expect(CABINET.inkMuted).toBe(token("--color-text-muted", "dark"));
    expect(CABINET.accent).toBe(token("--color-accent", "dark"));
  });

  it("table ground matches the real tokens", () => {
    expect(TABLE.bg).toBe(token("--color-table"));
    expect(TABLE.panel).toBe(token("--color-bg"));
    expect(TABLE.line).toBe(token("--color-table-line"));
    expect(TABLE.ink).toBe(token("--color-text"));
    expect(TABLE.inkMuted).toBe(token("--color-text-muted"));
    expect(TABLE.accent).toBe(token("--color-accent"));
  });

  it("Drunk Walk's scene colours match its tokens", () => {
    expect(DRUNK_WALK.asphalt).toBe(token("--color-asphalt"));
    expect(DRUNK_WALK.asphaltFar).toBe(token("--color-asphalt-far"));
    expect(DRUNK_WALK.left).toBe(token("--color-player-1"));
    expect(DRUNK_WALK.right).toBe(token("--color-player-2"));
  });
});

/** Relative luminance per WCAG 2.1, from a `#rrggbb` string. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("card text is legible on its own ground", () => {
  // A card is an image with no theme and no user override — whatever contrast it
  // ships with is the contrast everyone gets, forever. The hero is large text (AA
  // wants 3:1) but is held to the stricter 4.5:1 anyway; the muted ink carries small
  // text and must clear 4.5:1 outright.
  it.each([
    ["cabinet ink", CABINET.ink, CABINET.bg, 4.5],
    ["cabinet muted ink", CABINET.inkMuted, CABINET.bg, 4.5],
    ["table ink", TABLE.ink, TABLE.bg, 4.5],
    ["table muted ink", TABLE.inkMuted, TABLE.bg, 4.5],
  ])("%s clears AA", (_label, fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  it("footer ink clears AA over Drunk Walk's road, which it is drawn on top of", () => {
    // Caught by rendering the card and looking at it: the bespoke card's road runs under
    // the footer, so the footer's contrast is against asphalt, not against the cabinet
    // ground the other assertions here cover. The lighter `--color-asphalt` measured
    // ~4.1:1 and failed; the card uses the darker far tone for the surface because of it.
    expect(contrast(CABINET.inkMuted, DRUNK_WALK.asphaltFar)).toBeGreaterThanOrEqual(4.5);
  });

  it("the accent is only used as a graphic, so it needs 3:1 not 4.5:1", () => {
    // It paints a 5px rule, never text — WCAG 1.4.11 (non-text contrast) applies.
    expect(contrast(CABINET.accent, CABINET.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(TABLE.accent, TABLE.bg)).toBeGreaterThanOrEqual(3);
  });
});
