import type { GameId, RealtimeGameId } from "@mpg/engine";
import { Button } from "../components/ui";
import { nextGame, prevGame, type GameItem } from "./catalog";
import styles from "./GameSwitcher.module.css";

export interface GameSwitcherProps {
  /** The ordered catalog to walk — from `buildGameItems`. */
  items: GameItem[];
  /** The game currently being played. */
  currentId: GameId | RealtimeGameId;
  /** Title shown between the two controls. Falls back to the catalog title. */
  title?: string;
  /**
   * Switch to another game. Quick-starts it the same way Home does, so moving
   * between games never routes through setup.
   */
  onSwitch: (item: GameItem) => void;
}

/**
 * Prev / current / next control for hopping between games without going back to
 * Home. Wraps at both ends (`relativeGame`), so neither arrow is ever a dead
 * control — with 2+ games in the catalog both are always actionable.
 *
 * Renders nothing when there's nowhere to go (a single-game catalog), rather
 * than showing two disabled arrows that suggest a feature that isn't there.
 */
export function GameSwitcher({
  items,
  currentId,
  title,
  onSwitch,
}: GameSwitcherProps): React.JSX.Element | null {
  const previous = prevGame(items, currentId);
  const next = nextGame(items, currentId);
  if (!previous || !next) return null;

  const currentTitle = title ?? items.find((item) => item.id === currentId)?.title ?? currentId;

  return (
    <nav className={styles.switcher} aria-label="Switch game">
      <span className={styles.side}>
        <Button
          variant="ghost"
          size="sm"
          className={styles.sideButton}
          onClick={() => onSwitch(previous)}
          aria-label={`Previous game: ${previous.title}`}
        >
          <span aria-hidden="true">‹</span>
          <span className={styles.sideLabel}>{previous.title}</span>
        </Button>
      </span>
      {/* aria-current marks which of the three names is the one being played —
          without it the row reads as three equal links to a screen reader. */}
      <span className={styles.current} aria-current="page">
        {currentTitle}
      </span>
      <span className={`${styles.side} ${styles.sideEnd}`}>
        <Button
          variant="ghost"
          size="sm"
          className={styles.sideButton}
          onClick={() => onSwitch(next)}
          aria-label={`Next game: ${next.title}`}
        >
          <span className={styles.sideLabel}>{next.title}</span>
          <span aria-hidden="true">›</span>
        </Button>
      </span>
    </nav>
  );
}
