import { useId } from "react";
import type { GameId, RealtimeGameId } from "@mpg/engine";
import styles from "./gameThumbnails.module.css";

/**
 * Small decorative SVG previews shown on the Home game cards (MPG-052).
 * Purely illustrative — each card's accessible name stays the game title,
 * so every thumbnail is hidden from assistive tech (`aria-hidden` +
 * `focusable="false"`) and carries no text content.
 *
 * Colors come from the same `--color-player-1` / `--color-player-2` tokens
 * the real boards use, so thumbnails stay correct in light and dark theme
 * and never hardcode hex. No motion (reduced-motion is inherently honored:
 * there's nothing animated here).
 */

function TicTacToeThumbnail(): React.JSX.Element {
  return (
    <svg className={styles.svg} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g className={styles.grid} fill="none" strokeWidth="4" strokeLinecap="round">
        <line x1="34" y1="8" x2="34" y2="92" />
        <line x1="66" y1="8" x2="66" y2="92" />
        <line x1="8" y1="34" x2="92" y2="34" />
        <line x1="8" y1="66" x2="92" y2="66" />
      </g>
      {/* X in top-left cell */}
      <g className={styles.markPlayer1} strokeWidth="5" strokeLinecap="round">
        <line x1="14" y1="14" x2="26" y2="26" />
        <line x1="26" y1="14" x2="14" y2="26" />
      </g>
      {/* O in center cell */}
      <circle className={styles.markPlayer2} cx="50" cy="50" r="9" fill="none" strokeWidth="5" />
    </svg>
  );
}

function ConnectFourThumbnail(): React.JSX.Element {
  const cols = [15, 38, 61, 84];
  const rows = [15, 38, 61, 84];
  return (
    <svg className={styles.svg} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect
        x="4"
        y="4"
        width="92"
        height="92"
        rx="8"
        className={styles.grid}
        fill="none"
        strokeWidth="4"
      />
      {cols.map((cx) =>
        rows.map((cy) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="9" className={styles.slot} />
        )),
      )}
      {/* A couple of stacked player discs at the bottom of one column */}
      <circle cx={cols[1]} cy={rows[3]} r="9" className={styles.markPlayer1} />
      <circle cx={cols[1]} cy={rows[2]} r="9" className={styles.markPlayer2} />
      <circle cx={cols[2]} cy={rows[3]} r="9" className={styles.markPlayer2} />
    </svg>
  );
}

function TicTacToeMoveThumbnail(): React.JSX.Element {
  // Scoped so a second render of this thumbnail on the same page (e.g. a
  // future gallery/kit view) can't collide on the marker id.
  const arrowheadId = useId();

  return (
    <svg className={styles.svg} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g className={styles.grid} fill="none" strokeWidth="4" strokeLinecap="round">
        <line x1="34" y1="8" x2="34" y2="92" />
        <line x1="66" y1="8" x2="66" y2="92" />
        <line x1="8" y1="34" x2="92" y2="34" />
        <line x1="8" y1="66" x2="92" y2="66" />
      </g>
      {/* piece that's about to move */}
      <g className={styles.markPlayer1} strokeWidth="5" strokeLinecap="round">
        <line x1="14" y1="14" x2="26" y2="26" />
        <line x1="26" y1="14" x2="14" y2="26" />
      </g>
      {/* a second, settled piece */}
      <circle className={styles.markPlayer2} cx="82" cy="82" r="9" fill="none" strokeWidth="5" />
      {/* relocation cue: a subtle dashed arrow from the moving piece toward
          the empty center cell, hinting the "move a piece" variant. Part of
          the decorative graphic — not an independent focusable element. */}
      <path
        d="M 26 30 Q 40 44 46 46"
        className={styles.moveArrow}
        fill="none"
        strokeWidth="2.5"
        strokeDasharray="3 3"
        strokeLinecap="round"
        markerEnd={`url(#${arrowheadId})`}
      />
      <defs>
        <marker
          id={arrowheadId}
          markerWidth="6"
          markerHeight="6"
          refX="3"
          refY="3"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L6,3 L0,6 Z" className={styles.moveArrowHead} />
        </marker>
      </defs>
    </svg>
  );
}

function FloppyBirdsThumbnail(): React.JSX.Element {
  return (
    <svg className={styles.svg} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {/* Two pipe pairs framing passable gaps. */}
      <g className={styles.floppyPipe}>
        <rect x="20" y="0" width="16" height="38" rx="2" />
        <rect x="20" y="62" width="16" height="38" rx="2" />
        <rect x="64" y="0" width="16" height="24" rx="2" />
        <rect x="64" y="48" width="16" height="52" rx="2" />
      </g>
      {/* The bird, mid-flight between the gaps. */}
      <circle className={styles.floppyBird} cx="48" cy="52" r="9" />
      <circle className={styles.floppyEye} cx="51" cy="49" r="2" />
    </svg>
  );
}

function DrunkWalkThumbnail(): React.JSX.Element {
  return (
    <svg className={styles.svg} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {/* A foreshortened walkway receding to a horizon, echoing the live renderer. */}
      <path d="M 40 34 L 60 34 L 86 96 L 14 96 Z" className={styles.drunkGround} />
      <line
        x1="50"
        y1="34"
        x2="50"
        y2="96"
        className={styles.drunkDivider}
        strokeWidth="2"
        strokeDasharray="3 3"
      />
      {/* The leaning figure, tilted off vertical (the core mechanic). */}
      <g className={styles.drunkFigure} transform="rotate(18 50 82)">
        <rect x="45" y="56" width="10" height="26" rx="4" />
        <circle cx="50" cy="50" r="7" />
      </g>
    </svg>
  );
}

function NimThumbnail(): React.JSX.Element {
  // Four piles of matchstick-like objects — 1, 3, 5 and 7, the default Nim
  // layout — so the icon reads literally as "take objects from piles" rather
  // than as a bar chart. Each stick is a thin rounded rod with a small head.
  const piles = [
    { center: 12, count: 1 },
    { center: 33, count: 3 },
    { center: 57, count: 5 },
    { center: 84, count: 7 },
  ];
  const baseline = 90;
  const stickHeight = 46;
  const pitch = 4;
  return (
    <svg className={styles.svg} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <line x1="4" y1={baseline} x2="96" y2={baseline} className={styles.grid} strokeWidth="4" />
      {piles.flatMap(({ center, count }) => {
        const start = center - ((count - 1) * pitch) / 2;
        return Array.from({ length: count }, (_, i) => {
          const x = start + i * pitch;
          return (
            <g key={`${center}-${i}`} className={styles.markPlayer1} stroke="none">
              <rect
                x={x - 1.25}
                y={baseline - stickHeight}
                width="2.5"
                height={stickHeight}
                rx="1.25"
              />
              <circle cx={x} cy={baseline - stickHeight} r="2" />
            </g>
          );
        });
      })}
    </svg>
  );
}

/** Generic fallback so an uncatalogued game never renders without a thumbnail. */
function GenericThumbnail(): React.JSX.Element {
  return (
    <svg className={styles.svg} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect
        x="4"
        y="4"
        width="92"
        height="92"
        rx="8"
        className={styles.grid}
        fill="none"
        strokeWidth="4"
      />
      <line x1="4" y1="50" x2="96" y2="50" className={styles.grid} strokeWidth="4" />
      <line x1="50" y1="4" x2="50" y2="96" className={styles.grid} strokeWidth="4" />
    </svg>
  );
}

function ReflexTestThumbnail(): React.JSX.Element {
  return (
    <svg className={styles.svg} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {/* A two-lamp signal: red held, green lit — the flip the game is built on. */}
      <rect x="30" y="10" width="40" height="80" rx="14" className={styles.reflexHousing} />
      <circle cx="50" cy="34" r="12" className={styles.reflexLampRed} />
      <circle cx="50" cy="66" r="12" className={styles.reflexLampGreen} />
    </svg>
  );
}

function Game2048Thumbnail(): React.JSX.Element {
  return (
    <svg className={styles.svg} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {/* A 2×2 slice of the grid with two merged tiles — the game's whole idea. */}
      <rect x="8" y="8" width="38" height="38" rx="6" className={styles.tileLow} />
      <rect x="54" y="8" width="38" height="38" rx="6" className={styles.tileLow} />
      <rect x="8" y="54" width="38" height="38" rx="6" className={styles.tileHigh} />
      <rect x="54" y="54" width="38" height="38" rx="6" className={styles.tileHigh} />
    </svg>
  );
}

function BreakoutThumbnail(): React.JSX.Element {
  return (
    <svg className={styles.svg} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {/* Two rows of bricks, a ball mid-flight, and the paddle below. */}
      {[0, 1].map((r) =>
        [0, 1, 2, 3].map((c) => (
          <rect
            key={`${r}-${c}`}
            x={8 + c * 22}
            y={12 + r * 14}
            width="18"
            height="10"
            rx="2"
            className={r === 0 ? styles.brickAccent : styles.brickSuccess}
          />
        )),
      )}
      <circle cx="58" cy="60" r="5" className={styles.breakoutBall} />
      <rect x="36" y="84" width="28" height="7" rx="3.5" className={styles.breakoutPaddle} />
    </svg>
  );
}

// Partial, mirroring GAME_CATALOG's pattern (see HomeScreen.tsx): a game can
// exist without a bespoke thumbnail yet. GenericThumbnail below covers that.
export const GAME_THUMBNAILS: Partial<Record<GameId, () => React.JSX.Element>> = {
  tictactoe: TicTacToeThumbnail,
  connect4: ConnectFourThumbnail,
  "tictactoe-move": TicTacToeMoveThumbnail,
  nim: NimThumbnail,
};

/** Real-time (arcade) thumbnails — sibling of GAME_THUMBNAILS, keyed by RealtimeGameId. */
export const REALTIME_THUMBNAILS: Partial<Record<RealtimeGameId, () => React.JSX.Element>> = {
  "floppy-birds": FloppyBirdsThumbnail,
  "drunk-walk": DrunkWalkThumbnail,
  "reflex-test": ReflexTestThumbnail,
  "2048": Game2048Thumbnail,
  breakout: BreakoutThumbnail,
};

/** Accepts either family's id (both are plain string unions); falls back to the generic mark. */
export function GameThumbnail({ gameId }: { gameId: string }): React.JSX.Element {
  const Thumbnail =
    GAME_THUMBNAILS[gameId as GameId] ??
    REALTIME_THUMBNAILS[gameId as RealtimeGameId] ??
    GenericThumbnail;
  return <Thumbnail />;
}
