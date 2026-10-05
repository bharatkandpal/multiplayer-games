// MPG-115-a (UI-8): the one result card. The post-game overlay and the
// shared-link landing both render it, so what a stranger sees from a share link
// is the same thing the player saw when the game ended.
//
// Purely presentational: props in, markup out. It never fetches, so it can't
// block on or error from the network (offline play is inviolable). Anything
// that needs the network — rank, personal best — arrives as a slot the caller
// fills, and simply isn't there when the service is down.

import type { ReactNode } from "react";

import { cx } from "./cx";
import { RankDelta } from "./RankDelta";
import styles from "./ResultCard.module.css";

export interface ResultCardProps {
  /** Small caps line above the headline — normally the game's title. */
  eyebrow?: ReactNode;
  /** The outcome-first line ("Scored 42", "Game over"). */
  headline: ReactNode;
  /** Element for the headline: `h1` on a page of its own, `p` inside an overlay. */
  headingAs?: "h1" | "h2" | "p";
  /** Supporting lines under the headline (final score, verdict, date). */
  detail?: ReactNode;
  /**
   * Optional slot for score context (personal best, percentile — MPG-095) and
   * later card art (MPG-085). Not implemented here; renders nothing when absent.
   */
  context?: ReactNode;
  /**
   * MPG-115-b: how the run moved the player's rank. Renders "▲3 since last run"
   * only when both ranks are known and differ — absent otherwise.
   */
  rankDelta?: { rank?: number | null; previousRank?: number | null };
  /** Actions and extras (buttons, share, rank preview), stacked below. */
  children?: ReactNode;
  /** `start` for a page, `center` inside the game-over overlay. */
  align?: "start" | "center";
  /** `lg` for a page headline, `md` inside an overlay. */
  size?: "lg" | "md";
  className?: string;
}

export function ResultCard({
  eyebrow,
  headline,
  headingAs: Heading = "h2",
  detail,
  context,
  rankDelta,
  children,
  align = "start",
  size = "lg",
  className,
}: ResultCardProps): React.JSX.Element {
  return (
    <div
      data-result-card=""
      className={cx(styles.card, align === "center" && styles.center, className)}
    >
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <Heading className={cx(styles.headline, size === "md" && styles.headlineMd)}>
        {headline}
      </Heading>
      {detail}
      {context}
      {rankDelta ? <RankDelta {...rankDelta} /> : null}
      {children}
    </div>
  );
}
