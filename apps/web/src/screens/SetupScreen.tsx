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
  /**
   * MPG-012/MPG-025: creates a room instead of starting a local pass-and-play
   * game — an open human seat shows the invite-link flow, an all-bot config
   * (every seat `kind: "bot"`) instead starts a server-driven "watch" room.
   * Receives the real seat config to create with (MPG-025: previously this
   * screen ignored whatever was configured and the caller always hardcoded
   * an all-human invite — see the "Play online" vs. Customize section's
   * online action below for the two ways a caller ends up here). Optional —
   * omitted in contexts (e.g. tests) that don't wire up the room client.
   */
  onPlayOnline?: (seats: SeatsConfig) => void;
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
export function SetupScreen({
  gameId,
  onStart,
  onBack,
  onPlayOnline,
}: SetupScreenProps): React.JSX.Element {
  const catalogEntry = GAME_CATALOG[gameId];
  const playerCount = catalogEntry?.playerCount ?? 2;
  const [seats, setSeats] = useState<SeatsConfig>(() => createDefaultSeats(playerCount));
  const [botDifficulty, setBotDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const title = catalogEntry?.title ?? gameId;
  const customizeId = useId();
  const botDifficultyGroupId = useId();

  return (
    <div className={styles.main}>
      <div className={styles.backRow}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to games
        </Button>
      </div>
      <h1 className={styles.heading}>Set up {title}</h1>
      {catalogEntry?.description ? (
        <p className={styles.description}>{catalogEntry.description}</p>
      ) : null}

      <div className={styles.quickStart}>
        <div className={styles.botOption}>
          <Button
            variant="primary"
            className={styles.quickOption}
            onClick={() => onStart(presetSeats("bot", playerCount, botDifficulty))}
          >
            <span className={styles.quickContent}>
              <span className={styles.quickIcon} aria-hidden="true">
                🤖
              </span>
              <span className={styles.quickLabel}>Play vs Bot</span>
              <span className={styles.quickHint}>
                You vs a {DIFFICULTY_LABEL[botDifficulty].toLowerCase()} bot — starts right away
              </span>
            </span>
          </Button>

          <div className={styles.difficultyToggle} role="radiogroup" aria-label="Bot difficulty">
            {DIFFICULTIES.map((difficulty) => (
              <label key={difficulty} className={styles.difficultyChip} data-level={difficulty}>
                <input
                  className={styles.difficultyChipInput}
                  type="radio"
                  name={`${botDifficultyGroupId}-bot-difficulty`}
                  checked={botDifficulty === difficulty}
                  onChange={() => setBotDifficulty(difficulty)}
                />
                {DIFFICULTY_LABEL[difficulty]}
              </label>
            ))}
          </div>
        </div>
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
            <span className={styles.quickHint}>
              Everyone&apos;s human, take turns on this device
            </span>
          </span>
        </Button>
      </div>

      {onPlayOnline ? (
        <div className={styles.onlineSection}>
          <Button
            variant="secondary"
            className={styles.onlineOption}
            onClick={() => onPlayOnline(presetSeats("human", playerCount))}
          >
            <span className={styles.quickContent}>
              <span className={styles.quickIcon} aria-hidden="true">
                🔗
              </span>
              <span className={styles.quickLabel}>Play online</span>
              <span className={styles.quickHint}>
                Invite a friend with a link — play from any device
              </span>
            </span>
          </Button>
        </div>
      ) : null}

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
            {onPlayOnline ? (
              <Button variant="secondary" size="lg" onClick={() => onPlayOnline(seats)}>
                {seats.every((seat) => seat.kind === "bot")
                  ? "Watch online — all-bot"
                  : "Play online — this setup"}
              </Button>
            ) : null}
          </div>
          {onPlayOnline && seats.every((seat) => seat.kind === "bot") ? (
            <p className={styles.watchHint}>
              Every seat is a bot — this creates a live game you (and only you, for now) can watch
              play out on the server, paced move by move. Nobody takes a turn here.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
