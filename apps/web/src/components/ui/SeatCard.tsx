import { cx } from "./cx";
import styles from "./SeatCard.module.css";

export type SeatCardKind = "human" | "bot";

export interface SeatCardProps {
  /** 0-based seat index — drives both the "Player N" label and the color mapping. */
  seatIndex: number;
  /** Whether this seat is a human or a bot — shown as an avatar emoji (🤖 / 👤). */
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
 * Persistent "who is playing" indicator (MPG-042/047): one card per seat,
 * labelled simply "Player N" with a color-coded avatar — 🤖 for a bot, 👤 for
 * a human — tinted to match that seat's piece color on the board
 * (`--color-player-{n}`). The "Player N" text is itself the non-color-only
 * distinction between seats (UX_PRINCIPLES §4), so the avatar hue is free to
 * carry identity. The "active" state is the canonical whose-turn signal and
 * folds in the bot "thinking" affordance. Only two player color tokens exist
 * today; seats beyond 2 cycle through them (`seatIndex % 2`).
 */
export function SeatCard({
  seatIndex,
  kind,
  active,
  thinking = false,
  className,
}: SeatCardProps): React.JSX.Element {
  const colorSlot = (seatIndex % 2) + 1; // 1 or 2 — cycles for future >2-seat games.

  return (
    <div
      className={cx(styles.card, active && styles.active, className)}
      data-seat-index={seatIndex}
    >
      <span
        className={cx(styles.avatar, colorSlot === 1 ? styles.avatar1 : styles.avatar2)}
        role="img"
        aria-label={kind === "bot" ? "Bot" : "Human"}
      >
        {kind === "bot" ? "🤖" : "👤"}
      </span>
      <span className={styles.info}>
        <span className={styles.name}>Player {seatIndex + 1}</span>
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
