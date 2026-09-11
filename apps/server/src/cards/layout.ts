/**
 * The card's shared skeleton — the part every game's card agrees on, so a bespoke card
 * only has to supply its own motif and its own hero line.
 *
 * The layout is one idea: **one thing is big, everything else is texture.** A share card
 * is seen at perhaps 320px wide in a feed, and often smaller in a chat preview. At
 * quarter scale the 148px hero is a comfortable 37px and still reads at a glance; the
 * 30px eyebrow drops to 7px and becomes what it deserves to be — a grey smudge that
 * says "there is a label here". Designing for that ratio is why the hero is enormous
 * and why there is no third level of type.
 *
 * Two rules from PRD FR-23 (the "Wordle rule") are structural, not decorative:
 *
 *  • **No call to action.** No "Play now!", no button-shaped anything. The URL alongside
 *    the card is the invitation; a card that begs converts worse and ages badly.
 *  • **Spoiler-free.** The card never renders the final board, the winning line, or the
 *    move that ended it. It carries the *outcome*, not the *solution* — sharing a result
 *    must not spoil the game for the person you shared it with.
 */

import type { CardGround } from "./palette.js";
import { CARD_HEIGHT, CARD_WIDTH, n, rect, rule, text } from "./svg.js";

/** Left gutter, and the baseline grid the whole card hangs off. */
export const PAD = 72;

export const HERO_SIZE = 148;
export const EYEBROW_SIZE = 30;
export const SUB_SIZE = 38;
export const FOOTER_SIZE = 24;

/**
 * Baselines, fixed so every card in a feed shares one horizon.
 *
 * The hero sits below the optical centre rather than at it: rendered and looked at, a
 * baseline of 330 left a dead band between the sub-line and the footer that made the
 * card read as unfinished. Dropping it balances the block against the top gutter, and on
 * a card with a motif it seats the text just above the ground line.
 */
export const EYEBROW_Y = PAD + EYEBROW_SIZE;
export const HERO_Y = 352;
export const SUB_Y = HERO_Y + 68;
export const FOOTER_Y = CARD_HEIGHT - PAD + 8;

/**
 * The ground: an opaque fill plus its texture.
 *
 * The texture is the cabinet/table distinction made literal (`DESIGN_LANGUAGE` §2) —
 * horizontal scanlines for a lit screen, a ruled grid for a matte table. Both sit at
 * low opacity: at thumbnail size they should read as *material*, not as stripes, and
 * anything stronger turns to moiré when a feed resamples the image.
 */
export function ground(g: CardGround, family: "cabinet" | "table"): string {
  const parts: string[] = [
    rect({ x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT, fill: g.bg }),
  ];

  if (family === "cabinet") {
    for (let y = 0; y < CARD_HEIGHT; y += 6) {
      parts.push(rule(y, CARD_WIDTH, g.line, 1, 0.28));
    }
  } else {
    for (let y = PAD; y < CARD_HEIGHT; y += 42) {
      parts.push(rule(y, CARD_WIDTH, g.line, 1, 0.55));
    }
  }

  return parts.join("");
}

/**
 * A single accent rule under the eyebrow — the card's entire brand presence besides the
 * wordmark. `DESIGN_LANGUAGE` allows the accent once per surface; spending it on a 4px
 * bar rather than on the number keeps the number reading as *the score* rather than as
 * *our colour*.
 */
export function accentRule(g: CardGround): string {
  return rect({ x: PAD, y: EYEBROW_Y + 22, width: 96, height: 5, fill: g.accent, rx: 2.5 });
}

/** Micro-caps game label, top-left. Tracked out per the §3 label voice. */
export function eyebrow(label: string, g: CardGround): string {
  return text(label.toUpperCase(), {
    x: PAD,
    y: EYEBROW_Y,
    size: EYEBROW_SIZE,
    fill: g.inkMuted,
    weight: 700,
    tracking: 4,
  });
}

/**
 * The largest hero size at which `value` still fits the text column.
 *
 * There is no text measurement available here — no DOM, no font metrics, and (per
 * `svg.ts`) not even a guarantee about which face the rasteriser resolves. So this
 * estimates from character count using a conservative average advance width, and only
 * ever shrinks. Being slightly too cautious costs a few points of size on a long
 * verdict; being too optimistic runs "Player 1 won" off the right edge of an image that
 * is then cached immutably, which is unfixable without a new URL.
 *
 * Pure and integral — same string in, same size out, so the card stays byte-identical.
 */
export function heroSizeFor(value: string, mono: boolean): number {
  // Rough advance width as a fraction of font size. Mono is wider and, unlike the
  // display face, genuinely fixed-pitch, so its estimate can be tighter.
  const perChar = mono ? 0.62 : 0.58;
  const available = CARD_WIDTH - PAD * 2;
  const wanted = value.length * perChar * HERO_SIZE;
  if (wanted <= available) return HERO_SIZE;
  // Floor to a whole number: a fractional font-size would render identically but makes
  // the output noisier to diff, and this is the one size that varies per card.
  return Math.max(56, Math.floor(available / (value.length * perChar)));
}

/**
 * The hero line. `mono` switches to the data voice, which every score, time and rank
 * must use (`DESIGN_LANGUAGE` §3) — a verdict like "Draw" is prose and stays on display.
 */
export function hero(value: string, g: CardGround, mono: boolean): string {
  return text(value, {
    x: PAD,
    y: HERO_Y,
    size: heroSizeFor(value, mono),
    fill: g.ink,
    weight: 800,
    mono,
  });
}

/** The line under the hero that says what the number means. */
export function subline(label: string, g: CardGround): string {
  return text(label, { x: PAD, y: SUB_Y, size: SUB_SIZE, fill: g.inkMuted, weight: 600 });
}

/**
 * Footer: wordmark left, date right.
 *
 * Minimal branding by intent — a name, at the size of a credit, with no logo and no
 * URL. The card travels next to a link that already carries the domain; repeating it
 * inside the image just spends pixels the hero could have used.
 */
export function footer(dateLabel: string, g: CardGround): string {
  const parts = [
    text("multiplayer games", {
      x: PAD,
      y: FOOTER_Y,
      size: FOOTER_SIZE,
      fill: g.inkMuted,
      weight: 600,
      tracking: 1.5,
    }),
  ];
  if (dateLabel) {
    parts.push(
      text(dateLabel, {
        x: CARD_WIDTH - PAD,
        y: FOOTER_Y,
        size: FOOTER_SIZE,
        fill: g.inkMuted,
        weight: 500,
        anchor: "end",
        mono: true,
      }),
    );
  }
  return parts.join("");
}

/**
 * A soft vignette panel behind the text column, so the hero keeps its contrast even
 * where a bespoke motif runs underneath it. Drawn as a plain rect with a gradient rather
 * than a filter: filters are the least portable part of SVG across rasterisers, and this
 * card has to survive whichever one MPG-085-b picks.
 */
export function textScrim(g: CardGround): string {
  return (
    `<defs><linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${g.bg}" stop-opacity="0.94" />` +
    `<stop offset="0.5" stop-color="${g.bg}" stop-opacity="0.74" />` +
    `<stop offset="1" stop-color="${g.bg}" stop-opacity="0" />` +
    `</linearGradient></defs>` +
    `<rect x="0" y="0" width="${n(CARD_WIDTH * 0.62)}" height="${CARD_HEIGHT}" fill="url(#scrim)" />`
  );
}
