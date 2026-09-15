import { Button } from "./Button";
import styles from "./GameActionBar.module.css";

/** One destination in the bar — a neighbouring game, named so it can be read. */
export interface GameNavTarget {
  /** The game's own title. Shown as the button's visible label, never an icon alone. */
  title: string;
  onSelect: () => void;
}

/**
 * Where prev/next lead from the screen rendering the bar. Both are optional so
 * a one-game catalog (or a screen with nowhere to go) simply gets no arrows
 * rather than two dead controls.
 */
export interface GameNavigation {
  previous?: GameNavTarget;
  next?: GameNavTarget;
}

/** The mid-game opponent switch ("🤖 vs Bot" / "👥 Play a friend"). */
export interface OpponentAction {
  /** Decorative glyph, always paired with the visible `label`. */
  icon: string;
  label: string;
  onSelect: () => void;
}

export interface GameActionBarProps {
  navigation?: GameNavigation;
  opponent?: OpponentAction;
}

/**
 * MPG-136: the persistent in-game action bar — prev game · opponent switch ·
 * next game — pinned to the bottom of the play screen where a thumb already is.
 *
 * It exists because pilot users had to be *taught* that switching games and
 * switching to a bot were possible at all (UX_PRINCIPLES §9, DESIGN_LANGUAGE
 * §5). Two rules follow from that and are load-bearing here:
 *
 * - **Every control carries a visible text label.** An icon with an
 *   `aria-label` satisfies a screen reader and fails a sighted first-timer, so
 *   the neighbouring game's *name* is the label and the chevron is decoration.
 * - **Absent beats dead.** A slot with no action renders nothing at all (an
 *   empty grid cell holding the layout) rather than a disabled button — which
 *   is what keeps the same bar honest on the watch and online screens, where
 *   there is no opponent to switch.
 *
 * Pinned via `position: sticky` rather than `fixed`: it then occupies real
 * layout space and can never cover the content above it. Screens render it as
 * the last child of a full-height flex column, so it sits at the bottom of the
 * viewport on a short screen and sticks there on a tall one.
 */
export function GameActionBar({
  navigation,
  opponent,
}: GameActionBarProps): React.JSX.Element | null {
  const previous = navigation?.previous;
  const next = navigation?.next;
  if (!previous && !next && !opponent) return null;

  return (
    <nav className={styles.bar} aria-label="Game navigation">
      <div className={styles.inner}>
        <span className={styles.slot}>
          {previous ? (
            <Button
              variant="ghost"
              size="sm"
              className={styles.navButton}
              onClick={previous.onSelect}
            >
              <span className={styles.navContent}>
                <span aria-hidden="true">‹</span>
                <span className={styles.navLabel}>{previous.title}</span>
              </span>
            </Button>
          ) : null}
        </span>

        <span className={styles.slot}>
          {opponent ? (
            <Button variant="secondary" size="sm" onClick={opponent.onSelect}>
              <span className={styles.opponentContent}>
                <span aria-hidden="true">{opponent.icon}</span>
                {opponent.label}
              </span>
            </Button>
          ) : null}
        </span>

        <span className={`${styles.slot} ${styles.slotEnd}`}>
          {next ? (
            <Button variant="ghost" size="sm" className={styles.navButton} onClick={next.onSelect}>
              <span className={styles.navContent}>
                <span className={styles.navLabel}>{next.title}</span>
                <span aria-hidden="true">›</span>
              </span>
            </Button>
          ) : null}
        </span>
      </div>
    </nav>
  );
}
