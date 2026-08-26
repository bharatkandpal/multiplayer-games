import { useId, useState } from "react";
import type { Difficulty, GameId } from "@mpg/engine";
import { Button } from "../components/ui";
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  DEFAULT_DIFFICULTY,
  createDefaultSeats,
  presetSeats,
  type SeatConfig,
  type SeatsConfig,
} from "../game";
import { GAME_CATALOG } from "./HomeScreen";
import styles from "./SetupScreen.module.css";

export interface SetupScreenProps {
  gameId: GameId;
  onStart: (seats: SeatsConfig) => void;
  onBack: () => void;
}

function updateSeat(seats: SeatsConfig, index: number, seat: SeatConfig): SeatsConfig {
  return seats.map((existing, i) => (i === index ? seat : existing));
}

interface SeatEditorProps {
  index: number;
  seat: SeatConfig;
  onChange: (seat: SeatConfig) => void;
}

/** One seat's Human/Bot + difficulty controls. Any combination is valid. */
function SeatEditor({ index, seat, onChange }: SeatEditorProps): React.JSX.Element {
  const groupName = useId();

  return (
    <fieldset className={styles.seatCard}>
      <legend className={styles.seatLegend}>Player {index + 1}</legend>

      <div className={styles.kindOptions} role="radiogroup" aria-label={`Player ${index + 1} type`}>
        <div className={styles.kindOption}>
          <label className={styles.kindLabel}>
            <input
              className={styles.kindInput}
              type="radio"
              name={`${groupName}-kind`}
              checked={seat.kind === "human"}
              onChange={() => onChange({ kind: "human" })}
            />
            Human
          </label>
        </div>
        <div className={styles.kindOption}>
          <label className={styles.kindLabel}>
            <input
              className={styles.kindInput}
              type="radio"
              name={`${groupName}-kind`}
              checked={seat.kind === "bot"}
              onChange={() => onChange({ kind: "bot", difficulty: DEFAULT_DIFFICULTY })}
            />
            Bot
          </label>
        </div>
      </div>

      {seat.kind === "bot" ? (
        <div className={styles.difficultyField}>
          <label className={styles.difficultyLabel} htmlFor={`${groupName}-difficulty`}>
            Difficulty
          </label>
          <select
            id={`${groupName}-difficulty`}
            className={styles.difficultySelect}
            value={seat.difficulty}
            onChange={(event) =>
              onChange({ kind: "bot", difficulty: event.target.value as Difficulty })
            }
          >
            {DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {DIFFICULTY_LABEL[difficulty]}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * Seat-configuration screen (MPG-009/MPG-024/MPG-049). Leads with two
 * one-tap presets ("Play vs Bot" / "Play a friend") that start the game
 * immediately for the common cases, so most players never touch a control
 * beyond picking one of the two. The full per-seat editor (Human/Bot +
 * difficulty, any seat count) is still reachable behind a "Customize"
 * disclosure for mixed bot levels, local human-vs-human with 3+ seats, or
 * all-bot "watch" games.
 */
export function SetupScreen({ gameId, onStart, onBack }: SetupScreenProps): React.JSX.Element {
  const catalogEntry = GAME_CATALOG[gameId];
  const playerCount = catalogEntry?.playerCount ?? 2;
  const [seats, setSeats] = useState<SeatsConfig>(() => createDefaultSeats(playerCount));
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const title = catalogEntry?.title ?? gameId;
  const customizeId = useId();

  return (
    <div className={styles.main}>
      <div className={styles.backRow}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to games
        </Button>
      </div>
      <h1 className={styles.heading}>Set up {title}</h1>

      <div className={styles.quickStart}>
        <Button
          variant="primary"
          className={styles.quickOption}
          onClick={() => onStart(presetSeats("bot", playerCount))}
        >
          <span className={styles.quickContent}>
            <span className={styles.quickIcon} aria-hidden="true">
              🤖
            </span>
            <span className={styles.quickLabel}>Play vs Bot</span>
            <span className={styles.quickHint}>You vs a medium bot — starts right away</span>
          </span>
        </Button>
        <Button
          variant="primary"
          className={styles.quickOption}
          onClick={() => onStart(presetSeats("human", playerCount))}
        >
          <span className={styles.quickContent}>
            <span className={styles.quickIcon} aria-hidden="true">
              👥
            </span>
            <span className={styles.quickLabel}>Play a friend</span>
            <span className={styles.quickHint}>Everyone&apos;s human, take turns on this device</span>
          </span>
        </Button>
      </div>

      <div className={styles.customizeSection}>
        <Button
          variant="ghost"
          size="sm"
          className={styles.customizeToggle}
          aria-expanded={customizeOpen}
          aria-controls={customizeId}
          onClick={() => setCustomizeOpen((open) => !open)}
        >
          <span className={styles.customizeChevron} data-open={customizeOpen} aria-hidden="true">
            ▸
          </span>
          Customize seats
        </Button>

        <div
          id={customizeId}
          className={styles.customizeBody}
          data-open={customizeOpen}
          hidden={!customizeOpen}
        >
          <div className={styles.seats}>
            {seats.map((seat, index) => (
              <SeatEditor
                key={index}
                index={index}
                seat={seat}
                onChange={(nextSeat) => setSeats((prev) => updateSeat(prev, index, nextSeat))}
              />
            ))}
          </div>

          <div className={styles.actions}>
            <Button variant="primary" size="lg" onClick={() => onStart(seats)}>
              Start game
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
