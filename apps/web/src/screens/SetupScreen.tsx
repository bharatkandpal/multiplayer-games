import { useId, useState } from "react";
import type { Difficulty, GameId } from "@mpg/engine";
import { Button } from "../components/ui";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  createDefaultSeats,
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
 * Seat-configuration screen (MPG-009/MPG-024): renders one seat editor per
 * player the selected game supports (`GameModule.playerCount` — never a
 * hardcoded two), each independently Human or Bot(+level). Supports
 * human-vs-bot, local human-vs-human, mixed bot levels, and all-bot "watch"
 * games, for any seat count.
 */
export function SetupScreen({ gameId, onStart, onBack }: SetupScreenProps): React.JSX.Element {
  const catalogEntry = GAME_CATALOG[gameId];
  const playerCount = catalogEntry?.playerCount ?? 2;
  const [seats, setSeats] = useState<SeatsConfig>(() => createDefaultSeats(playerCount));
  const title = catalogEntry?.title ?? gameId;

  return (
    <div className={styles.main}>
      <div className={styles.backRow}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to games
        </Button>
      </div>
      <h1 className={styles.heading}>Set up {title}</h1>

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
  );
}
