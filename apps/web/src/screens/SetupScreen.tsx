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

function updateSeat(seats: SeatsConfig, index: 0 | 1, seat: SeatConfig): SeatsConfig {
  const next: [SeatConfig, SeatConfig] = [seats[0], seats[1]];
  next[index] = seat;
  return next;
}

interface SeatEditorProps {
  index: 0 | 1;
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
 * Seat-configuration screen (MPG-009): each of the game's two seats is
 * independently Human or Bot(+level) — supports human-vs-bot, local
 * human-vs-human, mixed bot levels, and all-bot "watch" games.
 */
export function SetupScreen({ gameId, onStart, onBack }: SetupScreenProps): React.JSX.Element {
  const [seats, setSeats] = useState<SeatsConfig>(() => createDefaultSeats());
  const title = GAME_CATALOG[gameId]?.title ?? gameId;

  return (
    <div className={styles.main}>
      <div className={styles.backRow}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to games
        </Button>
      </div>
      <h1 className={styles.heading}>Set up {title}</h1>

      <div className={styles.seats}>
        <SeatEditor
          index={0}
          seat={seats[0]}
          onChange={(seat) => setSeats((prev) => updateSeat(prev, 0, seat))}
        />
        <SeatEditor
          index={1}
          seat={seats[1]}
          onChange={(seat) => setSeats((prev) => updateSeat(prev, 1, seat))}
        />
      </div>

      <div className={styles.actions}>
        <Button variant="primary" size="lg" onClick={() => onStart(seats)}>
          Start game
        </Button>
      </div>
    </div>
  );
}
