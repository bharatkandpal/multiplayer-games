import { cx } from "./cx";
import styles from "./SeatCard.module.css";

export type SeatCardKind = "human" | "bot";

export interface SeatCardProps {
  /** 0-based seat index — drives the color/pattern mapping (see below). */
  seatIndex: number;
  /** Display-ready seat name, e.g. from `describeSeat(seats, seatIndex)`. */
  name: string;
  /** Whether this seat is a human or a bot — shown as a short label, never color-only. */
  kind: SeatCardKind;
  /** True when it's currently this seat's turn — the primary turn-ownership signal. */
  active: boolean;
  /**
   * True when this (active) seat is a bot computing its move. Only meaningful
   * alongside `active` — folds the "thinking" affordance into the seat's own
   * card instead of a separate/duplicate indicator elsewhere.
   */
  thinking?: boolean;
  className?: string | undefined;
}

/**
 * Persistent "who is playing" indicator (MPG-042): one card per seat, color-
 * coded to match that seat's piece color on the board (`--color-player-{n}`),
 * with a human/bot label and a highlighted "active" state that is the
 * canonical whose-turn signal (folds in the bot "thinking" affordance rather
 * than duplicating it elsewhere). Only two player color tokens exist today;
 * seats beyond 2 cycle through them (`seatIndex % 2`) rather than assuming
 * exactly two seats ever exist.
 */
export function SeatCard({
  seatIndex,
  name,
  kind,
  active,
  thinking = false,
  className,
}: SeatCardProps): React.JSX.Element {
  const swatchSlot = (seatIndex % 2) + 1; // 1 or 2 — cycles for future >2-seat games.

  return (
    <div
      className={cx(styles.card, active && styles.active, className)}
      data-seat-index={seatIndex}
    >
      <span
        className={cx(styles.swatch, swatchSlot === 1 ? styles.swatch1 : styles.swatch2)}
        aria-hidden="true"
      />
      <span className={styles.info}>
        <span className={styles.name}>{name}</span>
        <span className={cx(styles.kindLabel, kind === "bot" ? styles.kindBot : styles.kindHuman)}>
          {kind === "bot" ? "Bot" : "Human"}
        </span>
      </span>
      {active && thinking ? (
        <span className={styles.thinking} aria-hidden="true">
          <span className={styles.thinkingText}>Thinking</span>
          <span className={styles.thinkingDots}>
            <span className={styles.thinkingDot} />
            <span className={styles.thinkingDot} />
            <span className={styles.thinkingDot} />
          </span>
        </span>
      ) : null}
    </div>
  );
}
