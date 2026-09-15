import { Button } from "./Button";
import { Modal } from "./Modal";
import styles from "./RulesSheet.module.css";

export interface RulesSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Named in the heading, so the sheet says which game it's explaining. */
  gameTitle: string;
  /** One sentence on what winning looks like. */
  goal: string;
  /** The mechanics in play order. */
  steps: readonly string[];
  /** Quirks and tips. Omit when the game has none — no empty section is rendered. */
  notes?: readonly string[];
  /**
   * Copy for the dismiss button. The sheet opens by itself the first time a
   * player meets a game, and "Got it" reads right there; a player who opened it
   * themselves mid-game is closing a reference, not agreeing to anything.
   */
  dismissLabel?: string;
}

/**
 * MPG-138: how to play, as a dialog over the board.
 *
 * Content is plain data (`goal`/`steps`/`notes`) rather than a rules object, so
 * this component stays presentational and the UI kit keeps its one-way import
 * out of the screens that own the prose.
 *
 * An ordered list is doing real work here — the steps are a sequence a player
 * moves through (what a turn is → what a tap does → how it ends), so the
 * numbers carry information rather than decorating it. The goal sits above them
 * as its own line because "what am I trying to do" is the question a first-timer
 * actually has; the mechanics only make sense once it's answered.
 */
export function RulesSheet({
  isOpen,
  onClose,
  gameTitle,
  goal,
  steps,
  notes,
  dismissLabel = "Got it",
}: RulesSheetProps): React.JSX.Element {
  return (
    <Modal
      isOpen={isOpen}
      title={`How to play ${gameTitle}`}
      onClose={onClose}
      closeLabel="Close rules"
    >
      <p className={styles.goal}>{goal}</p>

      <ol className={styles.steps}>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      {notes && notes.length > 0 ? (
        <ul className={styles.notes}>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <div className={styles.actions}>
        <Button variant="primary" onClick={onClose}>
          {dismissLabel}
        </Button>
      </div>
    </Modal>
  );
}
