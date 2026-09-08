import { describe, expect, it } from "vitest";

import {
  builtInGames,
  builtInRealtimeGames,
  registerBuiltInGames,
  registerBuiltInRealtimeGames,
} from "@mpg/engine";

/**
 * The enforced invariant behind the whole cosmetic layer (MPG-088-a): a
 * cosmetic is renderer-only, and provably cannot affect physics, scoring, or
 * the server's re-simulation anti-cheat check (MPG-065).
 *
 * "Provably" has to mean a test that FAILS when the invariant is broken, not a
 * comment asking people not to break it. Two independent guards, because they
 * catch different mistakes:
 *
 *  1. A source guard over `packages/engine` — catches the violation at its
 *     root, the moment anyone adds a cosmetic field, import, or even the word
 *     to the engine. This is the one that matters: if the engine never learns
 *     what a hat is, no hat can change a simulation.
 *  2. A state-shape guard — catches a cosmetic smuggled into engine state
 *     under a different name, by checking that no live module's state carries
 *     any key a registered cosmetic schema uses as a slot.
 */

/**
 * Every `.ts` file in the engine package, tests included, read as raw text.
 *
 * Uses Vite's `import.meta.glob` rather than `node:fs` deliberately: the web
 * tsconfig has no node types, and a guard that can't typecheck is a guard
 * somebody deletes.
 */
const ENGINE_SOURCES: Record<string, string> = import.meta.glob(
  "../../../../../packages/engine/src/**/*.ts",
  { query: "?raw", import: "default", eager: true },
);

/** Trims the long relative prefix so a failure message names the file plainly. */
function shortName(path: string): string {
  return path.replace(/^.*packages\/engine\/src\//, "");
}

/**
 * Words that would only appear in the engine if cosmetics had leaked across the
 * boundary. Kept narrow and specific on purpose — a broad list ("color",
 * "style") would fire on legitimate engine code and get muted, which is how
 * guards like this die.
 */
const FORBIDDEN = [/cosmetic/i, /\bhairColor\b/, /\bskinTone\b/, /CosmeticConfig/];

describe("cosmetics are renderer-only — engine source guard", () => {
  const entries = Object.entries(ENGINE_SOURCES);

  it("finds engine sources to scan (guards against the guard silently scanning nothing)", () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it("no engine source mentions cosmetics", () => {
    const offenders: string[] = [];
    for (const [path, contents] of entries) {
      for (const pattern of FORBIDDEN) {
        if (pattern.test(contents)) {
          offenders.push(`${shortName(path)} matches ${String(pattern)}`);
        }
      }
    }
    // If this fails: a cosmetic concept reached the engine. Move it back into
    // the renderer — do not relax the pattern list.
    expect(offenders).toEqual([]);
  });

  it("no engine source imports the client cosmetic layer", () => {
    const offenders = entries
      .filter(([, contents]) => /from\s+["'][^"']*cosmetics/.test(contents))
      .map(([path]) => shortName(path));
    expect(offenders).toEqual([]);
  });
});

describe("cosmetics are renderer-only — engine state-shape guard", () => {
  it("no built-in module's state carries a cosmetic slot key", () => {
    registerBuiltInGames();
    registerBuiltInRealtimeGames();

    // Slot ids used by the shipped schemas, plus the generic ones any future
    // schema is likely to reuse.
    const cosmeticKeys = new Set([
      "hat",
      "beard",
      "hair",
      "accessory",
      "skin",
      "hairColor",
      "clothes",
      "shoes",
      "cosmetics",
      "palette",
    ]);

    const states: Record<string, unknown>[] = [
      ...builtInGames.map(
        (game) => game.createInitialState() as unknown as Record<string, unknown>,
      ),
      ...builtInRealtimeGames.map(
        (game) => game.createInitialState(1) as unknown as Record<string, unknown>,
      ),
    ];

    for (const state of states) {
      for (const key of Object.keys(state)) {
        expect(cosmeticKeys.has(key)).toBe(false);
      }
    }
  });
});
