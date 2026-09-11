/**
 * Drunk Walk's bespoke card — the proof that a game can own its card without the card
 * system knowing anything about that game (MPG-085-a).
 *
 * **What makes it Drunk Walk:** a walker tipped past the angle the engine calls a fall,
 * standing on the road, with the two tap zones the player spent the whole run choosing
 * between showing faintly underfoot. Colours are the scene's own, so the card looks like
 * the thing the player just closed.
 *
 * **Why it is flat rather than perspectival.** The first version drew the road receding
 * to a vanishing point and the figure with articulated limbs. Rendered and looked at, it
 * read as two coloured wedges and a broken puppet — and that was at full size; a feed
 * thumbnail is a quarter of this. What survives being shrunk is a strong, simple
 * silhouette against a plain ground, so that is what this draws now.
 *
 * **Everything is derived from `score` and constants.** No RNG, no clock. The scene
 * itself is seeded-random, and reaching for that seed to reproduce the "real" final pose
 * would tie the card to engine internals and re-render it differently the moment the
 * physics are tuned. The card is an emblem of the moment, not a screenshot of it.
 *
 * **Spoiler-free** is trivial for a real-time game — no solution to spoil — but it still
 * shapes one choice: no path *shape*, no "here is where you fell". Just distance.
 */

import { accentRule, eyebrow, footer, hero, ground, subline, textScrim } from "./layout.js";
import { CABINET, DRUNK_WALK } from "./palette.js";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  circle,
  ellipse,
  formatCount,
  formatUtcDate,
  line,
  rect,
  svgDocument,
} from "./svg.js";
import { gameTitle } from "./titles.js";
import type { ResultCardInput } from "./types.js";

/** Where the road's surface sits. Flat — see the note above on perspective. */
const GROUND_Y = 470;

/** The angle the engine calls a fall (`WORLD.failAngleDeg`). Mirrored, not imported:
 *  the card is a picture of the moment, not a simulation of it, and pinning the pose
 *  means a physics re-tune cannot silently change every already-cached card. */
const FALL_ANGLE_DEG = 50;

/** The figure's planted foot — the pivot, and the one point that stays put. */
const FOOT_X = 950;
const FOOT_Y = GROUND_Y + 34;

/**
 * The road runs the full width of the card rather than starting at the motif.
 *
 * An earlier pass began it at x=560 to keep it clear of the text, which gave it a hard
 * vertical edge in open space — it read as a rectangle pasted onto the card rather than
 * as ground the figure stands on. Full-bleed has no edge to notice, and the text scrim
 * already fades it out under the score.
 */
const ROAD_LEFT = 0;

/**
 * The road: a flat band, tinted left-to-right across the two tap zones.
 *
 * Two things here were found by rendering the card and looking at it, not by reasoning:
 *
 *  • **The zones are a gradient, not two rectangles.** Painting the left half blue and
 *    the right half orange put a hard vertical seam down the middle of the road, which
 *    read as a rendering bug rather than as a design. A gradient carries the same idea —
 *    the run was spent choosing between these two sides — with nothing to mistake for an
 *    artifact.
 *  • **The surface uses the FAR asphalt tone, which is the darker one.** The card's
 *    footer sits over the road, and muted ink on `--color-asphalt` measures about 4.1:1
 *    — under AA for small text. On `--color-asphalt-far` it clears 5.5:1. The lighter
 *    tone survives as a thin lip along the top edge, where no text goes.
 */
function road(): string {
  const width = CARD_WIDTH - ROAD_LEFT;
  const depth = CARD_HEIGHT - GROUND_Y;

  return [
    `<defs><linearGradient id="dw-zones" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="${DRUNK_WALK.left}" stop-opacity="0.16" />` +
      `<stop offset="0.5" stop-color="${DRUNK_WALK.left}" stop-opacity="0" />` +
      `<stop offset="0.5" stop-color="${DRUNK_WALK.right}" stop-opacity="0" />` +
      `<stop offset="1" stop-color="${DRUNK_WALK.right}" stop-opacity="0.16" />` +
      `</linearGradient></defs>`,
    // The lit lip along the near edge of the road, then the surface itself.
    rect({ x: ROAD_LEFT, y: GROUND_Y - 8, width, height: 8, fill: DRUNK_WALK.asphalt }),
    rect({ x: ROAD_LEFT, y: GROUND_Y, width, height: depth, fill: DRUNK_WALK.asphaltFar }),
    rect({ x: ROAD_LEFT, y: GROUND_Y, width, height: depth, fill: "url(#dw-zones)" }),
    // Lane dashes, running away from the figure rather than underneath it — an earlier
    // pass centred them on the road and they came out as stray marks behind the walker's
    // legs. Evenly spaced, because a flat road has no perspective to imply.
    ...[0, 1, 2].map((i) =>
      rect({
        x: 604 + i * 112,
        y: GROUND_Y + 74,
        width: 64,
        height: 8,
        fill: DRUNK_WALK.figure,
        rx: 4,
        opacity: 0.22,
      }),
    ),
  ].join("");
}

/** A point in the figure's local frame: origin at the planted foot, +y upward. */
interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The walker's pose, authored upright and then tipped as one rigid body.
 *
 * Building it upright first is the whole trick: hand-placing each limb at its already-
 * rotated position is what produced the first attempt's tangle of crossed arms. Here the
 * pose is written the way a person is shaped, and the fall is a single transform — which
 * is also how the game's own physics treats it, one angle about the planted foot.
 */
const POSE = {
  foot: { x: 0, y: 0 },
  hip: { x: 0, y: 98 },
  shoulder: { x: 0, y: 172 },
  head: { x: 0, y: 208 },
  /** Flung up and back — the universally readable "losing my balance" gesture. */
  armBack: { x: -64, y: 216 },
  armFore: { x: 66, y: 198 },
  /** The trailing leg, kicked out ahead of the fall. */
  legTrail: { x: 68, y: 30 },
} as const satisfies Record<string, LocalPoint>;

const FALL_RAD = (FALL_ANGLE_DEG * Math.PI) / 180;

/** Rotates a local point into card coordinates, leaning the figure to its left. */
function place(p: LocalPoint): { readonly x: number; readonly y: number } {
  const cos = Math.cos(FALL_RAD);
  const sin = Math.sin(FALL_RAD);
  return {
    x: FOOT_X + (p.x * cos - p.y * sin),
    y: FOOT_Y - (p.x * sin + p.y * cos),
  };
}

function walker(): string {
  const foot = place(POSE.foot);
  const hip = place(POSE.hip);
  const shoulder = place(POSE.shoulder);
  const head = place(POSE.head);
  const armBack = place(POSE.armBack);
  const armFore = place(POSE.armFore);
  const legTrail = place(POSE.legTrail);

  return [
    // The shadow stays flat and un-rotated — it belongs to the road, not to the body.
    ellipse(FOOT_X, FOOT_Y + 4, 58, 11, DRUNK_WALK.asphaltFar, 0.75),
    // Legs in the shade tone, so they sit behind the torso without needing an outline.
    line(foot.x, foot.y, hip.x, hip.y, DRUNK_WALK.figureShade, 20),
    line(hip.x, hip.y, legTrail.x, legTrail.y, DRUNK_WALK.figureShade, 18),
    line(hip.x, hip.y, shoulder.x, shoulder.y, DRUNK_WALK.figure, 24),
    line(shoulder.x, shoulder.y, armBack.x, armBack.y, DRUNK_WALK.figure, 15),
    line(shoulder.x, shoulder.y, armFore.x, armFore.y, DRUNK_WALK.figure, 15),
    circle(head.x, head.y, 31, DRUNK_WALK.figure),
  ].join("");
}

/** A dusk sky above the road, so the cabinet ground reads as evening, not as a void. */
function sky(): string {
  return [
    `<defs><linearGradient id="dw-sky" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${CABINET.bg}" />` +
      `<stop offset="1" stop-color="${CABINET.panel}" />` +
      `</linearGradient></defs>`,
    rect({ x: 0, y: 0, width: CARD_WIDTH, height: GROUND_Y - 18, fill: "url(#dw-sky)" }),
  ].join("");
}

export function renderDrunkWalkCard(result: ResultCardInput): string {
  const title = gameTitle(result.gameId);
  const distance = formatCount(result.score ?? 0);

  const body = [
    ground(CABINET, "cabinet"),
    sky(),
    road(),
    // Scrim over the scenery but UNDER the figure: the text column needs the contrast,
    // the figure needs to stay at full strength.
    textScrim(CABINET),
    walker(),
    eyebrow(title, CABINET),
    accentRule(CABINET),
    hero(distance, CABINET, true),
    // "steps" rather than "points": the score IS distance walked, one unit per tick
    // (`WORLD.forwardSpeedPerTick`), and naming it honestly is the better brag.
    subline("steps before falling over", CABINET),
    footer(formatUtcDate(result.createdAt), CABINET),
  ].join("");

  return svgDocument(`${distance} steps on ${title}`, body);
}
