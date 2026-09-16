import type { SeatsConfig } from "../../game";
import { cx } from "./cx";
import { SeatCard } from "./SeatCard";
import styles from "./SeatRail.module.css";

export interface SeatRailProps {
  /** Every seat in the game, in board order. Works for any seat count. */
  seats: SeatsConfig;
  /**
   * 0-based index of the seat whose turn it is, or `null` when nobody's is —
   * game over, or a screen with no turn concept. Callers convert from the
   * engine's 1-based `Player` themselves; the rail only ever speaks seat
   * indices, which is what makes it usable from watch mode (no local seat).
   */
  activeSeat: number | null;
  /** 0-based index of the seat computing a move, or `null`. */
  thinkingSeat?: number | null;
  /** 0-based index of the seat that won, or `null`. No crown on a draw. */
  winnerSeat?: number | null;
  className?: string | undefined;
}

/**
 * The seat rail (UI-6 / MPG-113): the one row of seat presence cards that sits
 * above the board on every turn-based play surface — local, online and watch.
 *
 * All three screens already render through `GamePlayScreenView`, so the markup
 * was shared; what was not shared was the *rule* for turning game state into
 * seat state. That mapping (which seat is active, which is thinking, which
 * wears the crown, and the fact that seats beyond the first two cycle through
 * the two player colours) lived inline in the play screen, which is where turn
 * affordances drift from. It lives here now, and the play screens pass seat
 * indices in.
 *
 * Deliberately not part of this component: the Okabe–Ito seat colour contract.
 * Seat identity still comes from `SeatCard`'s `--color-player-{n}` mapping,
 * unchanged — the rail composes seat cards, it does not re-derive them.
 */
export function SeatRail({
  seats,
  activeSeat,
  thinkingSeat = null,
  winnerSeat = null,
  className,
}: SeatRailProps): React.JSX.Element {
  return (
    <div className={cx(styles.rail, className)}>
      {seats.map((seat, index) => (
        <SeatCard
          key={index}
          seatIndex={index}
          kind={seat.kind}
          // A bot shows its roster name; humans keep the positional "Player N".
          name={seat.kind === "bot" ? seat.name : undefined}
          active={activeSeat === index}
          thinking={thinkingSeat === index}
          winner={winnerSeat === index}
        />
      ))}
    </div>
  );
}
