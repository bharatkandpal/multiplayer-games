/**
 * The share card's colour values — hand-mirrored from `apps/web/src/styles/tokens.css`.
 *
 * **Why these are copied rather than imported.** The server cannot import from
 * `apps/web` (ADR: only the frontend is distributable, and the import boundary runs
 * one way), and a rendered PNG sits outside any CSS cascade regardless — there is no
 * `var()` to resolve at raster time. `apps/web/public/favicon.svg` already carries the
 * same duplication for the same reason (MPG-110).
 *
 * **What keeps the copy honest:** every value below is asserted against the real
 * `tokens.css` by `__tests__/palette.test.ts`, which parses that file. Change a token
 * and the test fails here — the drift is caught at CI time rather than discovered in
 * someone's Slack unfurl months later.
 *
 * **Theme.** A card is a flat image; it has no theme to respond to and no way to know
 * whether the feed around it is light or dark. So each card commits to ONE ground,
 * chosen by game family rather than by viewer — the cabinet/table split in
 * `docs/DESIGN_LANGUAGE.md` §2 — and is fully opaque, so it reads on either backdrop
 * instead of half-dissolving into one of them. The contrast ratios noted per pairing
 * are the AA figures from `tokens.css`'s own header block.
 */

/** One card ground: a background plus the ink that is legible on it. */
export interface CardGround {
  /** Page background — always opaque; a card is never rendered onto a host backdrop. */
  readonly bg: string;
  /** A slightly raised panel used behind the hero, for depth without a border. */
  readonly panel: string;
  /** Hairline rules — the "ruled table" / "scanline" texture, at low contrast. */
  readonly line: string;
  /** Primary ink. Carries the hero. */
  readonly ink: string;
  /** Secondary ink — eyebrow, labels, footer. AA-clear, deliberately quieter. */
  readonly inkMuted: string;
  /** Brand plum, used at most once per card. */
  readonly accent: string;
}

/**
 * Real-time games — "the cabinet". Emissive, dark in both themes by design
 * (`DESIGN_LANGUAGE` §2's documented rule-break), which is exactly what a score card
 * wants anyway: a bright number on a dark panel survives thumbnail scaling best.
 */
export const CABINET: CardGround = {
  bg: "#120e1c", // --color-cabinet
  panel: "#241a33", // --color-cabinet-raised
  line: "#3a2c50", // --color-cabinet-line
  ink: "#f2eef8", // --color-on-cabinet
  inkMuted: "#a79fba", // --color-text-muted (dark) — 7.46:1 on --color-bg
  accent: "#f26fb2", // --color-accent (dark) — plum, lifted to hold up on a dark ground
};

/**
 * Turn-based games — "the table". Matte, ruled, unlit. A surface you place pieces on,
 * so the card reads as paper rather than as a screen.
 */
export const TABLE: CardGround = {
  bg: "#e9e5ee", // --color-table
  panel: "#f6f4f8", // --color-bg
  line: "#d2ccdd", // --color-table-line
  ink: "#191424", // --color-text — 16.47:1 on --color-bg
  inkMuted: "#5c5570", // --color-text-muted — 6.43:1 on --color-bg
  accent: "#a81e67", // --color-accent
};

/**
 * Drunk Walk's own scene colours, mirrored from `DrunkWalkScene.tsx`'s `readPalette`
 * so the card's motif is recognisably the same game the player just played — not a
 * generic figure in brand colours.
 */
export const DRUNK_WALK = {
  asphalt: "#3f4045", // --color-asphalt
  asphaltFar: "#2a2b2f", // --color-asphalt-far
  /** The two tap zones. Okabe–Ito seat colours, so left/right stay colour-blind safe. */
  left: "#0072b2", // --color-player-1
  right: "#b34700", // --color-player-2
  figure: "#ffd23f", // --color-warning (scene override)
  figureShade: "#9a5b00", // --color-warning-text
} as const;
