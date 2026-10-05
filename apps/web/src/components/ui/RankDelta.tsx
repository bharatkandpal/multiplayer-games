// MPG-115-b: "▲3 since last run" — how far the player's leaderboard rank moved
// with the run they just finished. Purely presentational and renders nothing
// unless there is a real, non-zero change to report: no prior rank (a first run),
// no current rank (offline / submit failed) or an unchanged rank are all simply
// absent, never an error (offline play is inviolable).

import { cx } from "./cx";
import { VisuallyHidden } from "./VisuallyHidden";
import styles from "./RankDelta.module.css";

export interface RankDeltaProps {
  /** Rank after the run (1-based; lower is better). */
  rank?: number | null | undefined;
  /** Rank before the run. Absent/null on a first run. */
  previousRank?: number | null | undefined;
}

/** Places gained (positive) or lost (negative); `null` when there's nothing to compare. */
export function rankChange(
  rank: number | null | undefined,
  previousRank: number | null | undefined,
): number | null {
  if (typeof rank !== "number" || typeof previousRank !== "number") return null;
  if (!Number.isFinite(rank) || !Number.isFinite(previousRank)) return null;
  const delta = previousRank - rank;
  return delta === 0 ? null : delta;
}

export function RankDelta({ rank, previousRank }: RankDeltaProps): React.JSX.Element | null {
  const change = rankChange(rank, previousRank);
  if (change === null) return null;

  const up = change > 0;
  const places = Math.abs(change);
  const unit = places === 1 ? "place" : "places";

  return (
    <p
      data-rank-delta={up ? "up" : "down"}
      className={cx(styles.delta, up ? styles.up : styles.down)}
    >
      {/* The glyph is decoration: direction is carried by the shape (▲/▼) for sighted
          users and by this plain-language sentence for assistive tech. */}
      <span aria-hidden="true">
        {up ? "▲" : "▼"}
        {places} since last run
      </span>
      <VisuallyHidden>
        {up ? "Up" : "Down"} {places} {unit} since your last run
      </VisuallyHidden>
    </p>
  );
}
