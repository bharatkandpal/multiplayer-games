import { useState, type ReactNode } from "react";
import type { GameModule, Player, Result } from "@mpg/engine";
import { Button, Modal, StatusBadge, Toast, VisuallyHidden } from "../components/ui";
import type { StatusBadgeStatus } from "../components/ui";
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

function seatIndexOf(player: Player): 0 | 1 {
  return player === 1 ? 0 : 1;
}

function resultHeadline(result: Result, seats: SeatsConfig): string {
  if (result.status === "draw") return "It's a draw!";
  if (result.status === "win") return `${describeSeat(seats, seatIndexOf(result.winner))} wins!`;
  return "";
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

  // The result modal can be dismissed (Esc / backdrop / ×) to reveal the
  // final board without leaving the game — only the explicit Rematch /
  // "Back to home" buttons below navigate away from the terminal state.
  const [resultDismissed, setResultDismissed] = useState(false);

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

  return (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <Button variant="ghost" size="sm" onClick={onExit}>
          ← Back to games
        </Button>
        <h1 className={styles.heading}>{gameTitle}</h1>
      </div>

      <div className={styles.statusRow}>
        <StatusBadge status={badgeStatus} busy={thinkingSeat !== null}>
          {badgeText}
        </StatusBadge>
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

      <div className={styles.boardWrap}>
        {renderBoard({
          state: session.state,
          onMove: play,
          disabled: boardDisabled,
          lastMove: session.lastMove,
          winningLine,
        })}
      </div>

      <div aria-live="polite" role="status">
        <VisuallyHidden>{announcement}</VisuallyHidden>
      </div>

      {/*
        MPG-036: Esc / backdrop-click / × only dismiss this modal — they
        reveal the finished board underneath rather than exiting to Home.
        The board is already disabled once the game is over (boardDisabled
        above), so revealing it can't accept further moves. The only ways
        to navigate off the terminal state are the explicit Rematch and
        "Back to home" buttons.
      */}
      <Modal
        isOpen={isGameOver && !resultDismissed}
        title={resultHeadline(session.result, seats)}
        onClose={() => setResultDismissed(true)}
      >
        <div className={styles.resultBody}>
          <p className={styles.resultMessage}>
            {session.result.status === "draw"
              ? "Good game — nobody blinked."
              : "Nice game! Ready for a rematch?"}
          </p>
          <div className={styles.resultActions}>
            <Button
              variant="primary"
              onClick={() => {
                setResultDismissed(false);
                rematch();
              }}
            >
              Rematch
            </Button>
            <Button variant="secondary" onClick={onExit}>
              Back to home
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
