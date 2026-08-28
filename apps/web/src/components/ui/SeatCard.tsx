import { cx } from "./cx";
import { VisuallyHidden } from "./VisuallyHidden";
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
  /**
   * True when this seat won the game (MPG-051). Independent of tone — shown
   * on the winning seat in every mode, including the "subdued" defeat case
   * (the winning bot still gets its crown). Renders a persistent 👑 badge.
   */
  winner?: boolean;
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
  winner = false,
  className,
}: SeatCardProps): React.JSX.Element {
  const colorSlot = (seatIndex % 2) + 1; // 1 or 2 — cycles for future >2-seat games.

  return (
    <div
      className={cx(styles.card, active && styles.active, winner && styles.winner, className)}
      data-seat-index={seatIndex}
    >
      <span
        className={cx(styles.avatar, colorSlot === 1 ? styles.avatar1 : styles.avatar2)}
        role="img"
        aria-label={kind === "bot" ? "Bot" : "Human"}
      >
        {kind === "bot" ? "🤖" : "👤"}
        {winner ? (
          <span className={styles.crown} aria-hidden="true">
            👑
          </span>
        ) : null}
        {/*
          Bot "thinking" affordance: a rotating spinner ring overlaid on the
          active seat's avatar (absolutely positioned, so it never changes the
          card's dimensions — the old inline "Thinking…" text did, jittering
          the seat row / board layout on every bot turn). Decorative
          (aria-hidden); the status badge + aria-live region carry "is
          thinking" for assistive tech.
        */}
        {active && thinking ? <span className={styles.spinner} aria-hidden="true" /> : null}
      </span>
      <span className={styles.info}>
        <span className={styles.name}>Player {seatIndex + 1}</span>
      </span>
      {/*
        MPG-051: the crown emoji above is purely decorative (aria-hidden) — it
        pairs with this persistent, non-live "Winner" text so the outcome is
        distinguishable non-visually too, without re-announcing anything (the
        aria-live region separately announces "Player N wins!" once, on
        game-over; this is static content encountered on navigating to the
        seat, not an announcement).
      */}
      {winner ? <VisuallyHidden>Winner</VisuallyHidden> : null}
    </div>
  );
}
