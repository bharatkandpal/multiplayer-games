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

// Partial, mirroring GAME_CATALOG's pattern (see HomeScreen.tsx): a game can
// exist without a bespoke thumbnail yet. GenericThumbnail below covers that.
export const GAME_THUMBNAILS: Partial<Record<GameId, () => React.JSX.Element>> = {
  tictactoe: TicTacToeThumbnail,
  connect4: ConnectFourThumbnail,
  "tictactoe-move": TicTacToeMoveThumbnail,
};

/** Real-time (arcade) thumbnails — sibling of GAME_THUMBNAILS, keyed by RealtimeGameId. */
export const REALTIME_THUMBNAILS: Partial<Record<RealtimeGameId, () => React.JSX.Element>> = {
  "floppy-birds": FloppyBirdsThumbnail,
};

/** Accepts either family's id (both are plain string unions); falls back to the generic mark. */
export function GameThumbnail({ gameId }: { gameId: string }): React.JSX.Element {
  const Thumbnail =
    GAME_THUMBNAILS[gameId as GameId] ??
    REALTIME_THUMBNAILS[gameId as RealtimeGameId] ??
    GenericThumbnail;
  return <Thumbnail />;
}
