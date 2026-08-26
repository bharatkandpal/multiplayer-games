import { useEffect, useRef, type ReactNode } from "react";
import type { GameModule, Player, Result } from "@mpg/engine";
import { Button, SeatCard, StatusBadge, Toast, VisuallyHidden } from "../components/ui";
import type { StatusBadgeStatus } from "../components/ui";
import { cx } from "../components/ui/cx";
import {
  type AppliedMove,
  type SeatsConfig,
  type WatchSpeed,
  describeSeat,
  useLocalPlayController,
} from "../game";
import styles from "./GamePlayScreen.module.css";

export interface BoardRenderProps<S, M, L = unknown> {
  state: S;
  onMove: (move: M) => void;
  disabled: boolean;
  lastMove: AppliedMove<M> | null;
  /** The winning line (game-native coords) once the game is won, else null — for highlighting. */
  winningLine: L | null;
}

export interface GamePlayScreenProps<S, M, L = unknown> {
  game: GameModule<S, M, L>;
  gameTitle: string;
  seats: SeatsConfig;
  renderBoard: (props: BoardRenderProps<S, M, L>) => ReactNode;
  /** Plain-language description of one move, for the screen-reader live region. */
  describeMove: (move: M, player: Player) => string;
  onExit: () => void;
}

/** Players are 1-based (`Player`); seats are 0-based array indices — works for any seat count. */
function seatIndexOf(player: Player): number {
  return player - 1;
}

function resultHeadline(result: Result, seats: SeatsConfig): string {
  if (result.status === "draw") return "It's a draw!";
  if (result.status === "win") return `${describeSeat(seats, seatIndexOf(result.winner))} wins!`;
  return "";
}

/**
 * The emotional register of the terminal state (MPG-044). "Lose" framing is
 * reserved for the one configuration where it's unambiguous: a single local
 * human seat that did not win. Everything else — human-vs-human on a shared
 * device, or an all-bot watch — reads as a neutral "X wins!" outcome (no one
 * local player "lost" it), never a somber "you lost".
 */
type ResultTone = "celebrate" | "subdued" | "neutral";

function resultTone(result: Result, seats: SeatsConfig): ResultTone {
  if (result.status !== "win") return "neutral"; // draw
  const humanSeatIndices = seats.reduce<number[]>((acc, seat, index) => {
    if (seat.kind === "human") acc.push(index);
    return acc;
  }, []);
  if (humanSeatIndices.length !== 1) return "neutral";
  const [soleHumanIndex] = humanSeatIndices;
  return seatIndexOf(result.winner) === soleHumanIndex ? "celebrate" : "subdued";
}

function resultMessage(tone: ResultTone, result: Result): string {
  if (result.status === "draw") return "Good game — nobody blinked.";
  if (tone === "celebrate") return "Nice game! Ready for a rematch?";
  if (tone === "subdued") return "Good effort — want to try again?";
  return "Good game! Ready for a rematch?";
}

/**
 * Generic game screen (MPG-009/MPG-010): renders the board, the turn/"thinking"
 * indicator, move-rejection feedback, and the win/lose/draw result — driven by
 * `useLocalPlayController`, which owns all bot-turn orchestration and pacing.
 * Engine-agnostic: callers supply `renderBoard`/`describeMove` for their game's
 * concrete state/move shape.
 */
export function GamePlayScreen<S, M, L = unknown>({
  game,
  gameTitle,
  seats,
  renderBoard,
  describeMove,
  onExit,
}: GamePlayScreenProps<S, M, L>): React.JSX.Element {
  const {
    session,
    isHumanTurn,
    thinkingSeat,
    isAllBots,
    watchSpeed,
    setWatchSpeed,
    isPaused,
    setPaused,
    canStep,
    step,
    play,
    clearError,
    rematch,
  } = useLocalPlayController(game, seats);

  const turnSeatIndex = seatIndexOf(session.turn);
  const turnSeatName = describeSeat(seats, turnSeatIndex);

  const badgeStatus: StatusBadgeStatus =
    session.status.type === "thinking"
      ? "info"
      : session.status.type === "game_over"
        ? "neutral"
        : isHumanTurn // "playing" or "error" — still this seat's turn either way.
          ? "success"
          : "neutral";
  const badgeText =
    session.status.type === "thinking"
      ? `${describeSeat(seats, seatIndexOf(session.status.player))} is thinking…`
      : session.status.type === "game_over"
        ? "Game over"
        : `${turnSeatName}'s turn`;

  const announcement = (() => {
    if (session.status.type === "error") return session.status.message;
    if (session.status.type === "game_over") return resultHeadline(session.result, seats);
    const lastMoveText = session.lastMove
      ? `${describeMove(session.lastMove.move, session.lastMove.player)}. `
      : "";
    if (session.status.type === "thinking") {
      return `${lastMoveText}${describeSeat(seats, seatIndexOf(session.status.player))} is thinking.`;
    }
    return `${lastMoveText}${turnSeatName}'s turn.`;
  })();

  const boardDisabled = !isHumanTurn;
  const isGameOver = session.status.type === "game_over";
  // The session layer erases the line's game-specific type to `unknown`; each
  // route re-supplies its concrete `L`, so this cast is safe and localized here.
  const winningLine = session.result.status === "win" ? (session.result.line as L) : null;

  const tone = resultTone(session.result, seats);

  // MPG-044: the result banner is inline (no modal to dismiss before the
  // board is visible), so on game-over move focus straight to Rematch — the
  // one obvious next action — rather than leaving focus stranded on the
  // last-clicked (now-disabled) board cell.
  const rematchButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isGameOver) rematchButtonRef.current?.focus();
  }, [isGameOver]);

  // MPG-042: one SeatCard per seat, split above/below the board — the primary
  // "whose turn" signal (folds in the bot "thinking" affordance, see below,
  // rather than duplicating it on the status badge too). First half of seats
  // above, the rest below; works for the current 2-seat games and degrades
  // sensibly if a future game has more seats.
  const aboveCount = Math.ceil(seats.length / 2);
  const seatsAbove = seats.slice(0, aboveCount);
  const seatsBelow = seats.slice(aboveCount);
  const thinkingSeatIndex = thinkingSeat !== null ? seatIndexOf(thinkingSeat) : null;

  const renderSeatCard = (seat: (typeof seats)[number], indexInSeats: number): ReactNode => (
    <SeatCard
      key={indexInSeats}
      seatIndex={indexInSeats}
      name={describeSeat(seats, indexInSeats)}
      kind={seat.kind}
      active={!isGameOver && turnSeatIndex === indexInSeats}
      thinking={thinkingSeatIndex === indexInSeats}
    />
  );

  return (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <Button variant="ghost" size="sm" onClick={onExit}>
          Home
        </Button>
        <h1 className={styles.heading}>{gameTitle}</h1>
      </div>

      <div className={styles.statusRow}>
        <StatusBadge status={badgeStatus}>{badgeText}</StatusBadge>
      </div>

      {isAllBots && !isGameOver ? (
        <fieldset className={styles.watchControls} aria-label="Watch controls">
          <div className={styles.watchGroup} role="group" aria-label="Playback speed">
            <span className={styles.watchLabel} aria-hidden="true">
              Speed
            </span>
            {(["1x", "2x", "instant"] as const).map((speed: WatchSpeed) => (
              <Button
                key={speed}
                variant={watchSpeed === speed ? "primary" : "ghost"}
                size="sm"
                aria-pressed={watchSpeed === speed}
                onClick={() => setWatchSpeed(speed)}
              >
                {speed === "instant" ? "Instant" : speed}
              </Button>
            ))}
          </div>
          <div className={styles.watchGroup}>
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={isPaused}
              onClick={() => setPaused(!isPaused)}
            >
              {isPaused ? "Resume" : "Pause"}
            </Button>
            <Button variant="ghost" size="sm" disabled={!canStep} onClick={step}>
              Step
            </Button>
          </div>
        </fieldset>
      ) : null}

      {session.status.type === "error" ? (
        <div className={styles.toastSlot}>
          <Toast variant="warning" onDismiss={clearError} autoDismissMs={5000}>
            {session.status.message}
          </Toast>
        </div>
      ) : null}

      <div className={styles.seatRow}>
        {seatsAbove.map((seat, i) => renderSeatCard(seat, i))}
      </div>

      <div className={styles.boardWrap}>
        {renderBoard({
          state: session.state,
          onMove: play,
          disabled: boardDisabled,
          lastMove: session.lastMove,
          winningLine,
        })}
      </div>

      {seatsBelow.length > 0 ? (
        <div className={styles.seatRow}>
          {seatsBelow.map((seat, i) => renderSeatCard(seat, aboveCount + i))}
        </div>
      ) : null}

      <div aria-live="polite" role="status">
        <VisuallyHidden>{announcement}</VisuallyHidden>
      </div>

      {/*
        MPG-044: the terminal state is inline, not a modal — the finished
        board (with its winning-line highlight) stays visible the instant the
        game ends, no dismiss step required. Tone (celebrate / subdued /
        neutral) is purely a CSS treatment; the copy and structure are the
        same for every outcome, and reduced-motion users get the identical
        end state with no animation (see the .module.css).
      */}
      {isGameOver ? (
        <div
          className={cx(
            styles.resultBanner,
            tone === "celebrate" && styles.resultCelebrate,
            tone === "subdued" && styles.resultSubdued,
            tone === "neutral" && styles.resultNeutral,
          )}
        >
          <p className={styles.resultHeadline}>{resultHeadline(session.result, seats)}</p>
          <p className={styles.resultMessage}>{resultMessage(tone, session.result)}</p>
          <div className={styles.resultActions}>
            <Button ref={rematchButtonRef} variant="primary" onClick={rematch}>
              Rematch
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
