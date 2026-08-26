import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import type { DrawReason, GameModule, Player, Result } from "@mpg/engine";
import { Button, SeatCard, StatusBadge, Toast, VisuallyHidden } from "../components/ui";
import type { StatusBadgeStatus } from "../components/ui";
import { cx } from "../components/ui/cx";
import {
  type AppliedMove,
  type OpponentPreset,
  type SeatsConfig,
  type WatchSpeed,
  describeSeat,
  presetSeats,
  sameSeatKinds,
  useLocalPlayController,
} from "../game";
import styles from "./GamePlayScreen.module.css";

/**
 * MPG-050: labels/emoji for the two opponent presets offered on game-over,
 * shared with the filtering logic below (only offer a preset that would
 * actually change the current seat kinds — no point re-offering "Play vs
 * Bot" on a game that's already human-vs-bot).
 */
const PLAY_AGAIN_PRESET_COPY: Record<OpponentPreset, { icon: string; label: string }> = {
  bot: { icon: "🤖", label: "Play vs Bot" },
  human: { icon: "👥", label: "Play a friend" },
};

export interface BoardRenderProps<S, M, L = unknown> {
  state: S;
  onMove: (move: M) => void;
  disabled: boolean;
  lastMove: AppliedMove<M> | null;
  /** The winning line (game-native coords) once the game is won, else null — for highlighting. */
  winningLine: L | null;
  /**
   * How the winning line should read (MPG-046): "win" (default) keeps the
   * normal success/green highlight; "loss" — reserved for the one
   * unambiguous case, a sole local human losing — recolors it red instead of
   * relying on a separate visible headline to carry the outcome.
   */
  winningLineTone?: "win" | "loss";
}

export interface GamePlayScreenProps<S, M, L = unknown> {
  game: GameModule<S, M, L>;
  gameTitle: string;
  seats: SeatsConfig;
  renderBoard: (props: BoardRenderProps<S, M, L>) => ReactNode;
  /** Plain-language description of one move, for the screen-reader live region. */
  describeMove: (move: M, player: Player) => string;
  onExit: () => void;
  /**
   * MPG-050: start a brand-new game against a different opponent preset
   * (rather than a same-opponent Rematch). When provided, the game-over
   * actions show a secondary "Play again vs…" group alongside Rematch. The
   * caller is responsible for actually restarting the session — typically by
   * remounting the play screen with the new seats (the local-play controller
   * only re-initializes on mount).
   */
  onPlayAgain?: (seats: SeatsConfig) => void;
}

/** Players are 1-based (`Player`); seats are 0-based array indices — works for any seat count. */
function seatIndexOf(player: Player): number {
  return player - 1;
}

/**
 * Human copy for each semantic draw reason the engine can emit (MPG-045-e).
 * The engine only surfaces the token (`DrawReason`); the client owns how it
 * reads. `undefined` (no reason given) falls back to the original generic
 * copy below.
 */
const DRAW_REASON_COPY: Record<DrawReason, string> = {
  repetition: "Draw — the same position repeated three times.",
  "board-full": "Draw — the board is full.",
};

function resultHeadline(result: Result, seats: SeatsConfig): string {
  if (result.status === "draw") {
    return result.reason ? (DRAW_REASON_COPY[result.reason] ?? "It's a draw!") : "It's a draw!";
  }
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

/** A CSS custom property bag, for the per-particle confetti variables below. */
type ConfettiVars = CSSProperties & Record<`--${string}`, string | number>;

const CONFETTI_COUNT = 60;

/**
 * A one-shot confetti burst (MPG-046/047, tone === "celebrate"). Full-viewport
 * (see `.confettiLayer` in the CSS), and runs a couple of seconds longer than
 * the original board-scoped burst. Pure CSS: each particle is a plain `<span>`
 * positioned/timed by inline CSS custom properties derived deterministically
 * from its index (no Math.random — stable across re-renders/tests, still
 * visually varied). Decorative only (`aria-hidden`); the outcome itself is
 * announced via the live region.
 */
function ConfettiBurst(): React.JSX.Element {
  return (
    <div className={styles.confettiLayer} aria-hidden="true">
      {Array.from({ length: CONFETTI_COUNT }, (_, i) => {
        const vars: ConfettiVars = {
          "--x": `${(i * 37) % 100}%`,
          "--hue": (i * 137) % 360,
          "--delay": `${(i % 12) * 80}ms`,
          "--duration": `${2800 + (i % 6) * 260}ms`,
          "--drift": `${((i * 53) % 160) - 80}px`,
          "--rotate": `${(i % 4 === 0 ? -1 : 1) * (360 + ((i * 53) % 360))}deg`,
        };
        return <span key={i} className={styles.confettiPiece} style={vars} />;
      })}
    </div>
  );
}

/**
 * Cracked-glass "defeat" overlay (MPG-047, tone === "subdued") — an inline SVG
 * of jagged fracture lines that snap in over the board (with a brief board
 * shake, applied on `.boardWrap`); the bot's winning line is recolored red by
 * the board itself. Replaces the earlier water/emoji treatment. Decorative
 * only (`aria-hidden`); reduced-motion draws the cracks instantly, no shake.
 */
function CrackedGlass(): React.JSX.Element {
  return (
    <div className={styles.loseCracks} aria-hidden="true">
      <svg className={styles.crackSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
        <g className={styles.crackGroup}>
          <polyline points="50,48 41,29 45,10" />
          <polyline points="50,48 69,39 90,42" />
          <polyline points="50,48 57,71 51,93" />
          <polyline points="50,48 29,58 7,63" />
          <polyline points="41,29 22,20" />
          <polyline points="69,39 76,19" />
          <polyline points="57,71 78,79" />
          <polyline points="29,58 20,80" />
        </g>
      </svg>
    </div>
  );
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
  onPlayAgain,
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

  // MPG-050: only offer a "play again vs…" preset when it would actually
  // change the current opponent type — e.g. a game that's already
  // human-vs-bot doesn't need a near-duplicate "Play vs Bot" next to
  // Rematch, just "Play a friend". Difficulty is deliberately irrelevant to
  // this check (`sameSeatKinds`) — swapping bot levels isn't a different
  // "opponent type" for this purpose.
  const playAgainPresets: readonly OpponentPreset[] = (["bot", "human"] as const).filter(
    (preset) => !sameSeatKinds(presetSeats(preset, seats.length), seats),
  );
  const playAgainHeadingId = useId();

  // MPG-044: the result banner is inline (no modal to dismiss before the
  // board is visible), so on game-over move focus straight to Rematch — the
  // one obvious next action — rather than leaving focus stranded on the
  // last-clicked (now-disabled) board cell.
  const rematchButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isGameOver) rematchButtonRef.current?.focus();
  }, [isGameOver]);

  // MPG-042/046: one SeatCard per seat, all in a single row above the board —
  // the primary "whose turn" signal (folds in the bot "thinking" affordance,
  // see below, rather than duplicating it on the status badge too).
  const thinkingSeatIndex = thinkingSeat !== null ? seatIndexOf(thinkingSeat) : null;

  const renderSeatCard = (seat: (typeof seats)[number], indexInSeats: number): ReactNode => (
    <SeatCard
      key={indexInSeats}
      seatIndex={indexInSeats}
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

      {/* MPG-046: all seats in a single row above the board. */}
      <div className={styles.seatRow}>
        {seats.map((seat, i) => renderSeatCard(seat, i))}
      </div>

      <div
        className={cx(styles.boardWrap, isGameOver && tone === "subdued" && styles.boardShake)}
      >
        {renderBoard({
          state: session.state,
          onMove: play,
          disabled: boardDisabled,
          lastMove: session.lastMove,
          winningLine,
          winningLineTone: tone === "subdued" ? "loss" : "win",
        })}

        {/* MPG-046/047: tone-specific decoration over the board, entirely
            aria-hidden — the outcome itself is carried by the live region
            below, not by these effects. */}
        {isGameOver && tone === "celebrate" ? <div className={styles.winFlash} aria-hidden="true" /> : null}
        {isGameOver && tone === "subdued" ? <CrackedGlass /> : null}
      </div>

      <div aria-live="polite" role="status">
        <VisuallyHidden>{announcement}</VisuallyHidden>
      </div>

      {/*
        MPG-044/046: the terminal state is inline, not a modal — the finished
        board (with its winning-line highlight, and the tone-specific
        celebration/consolation effects above) stays visible the instant the
        game ends, no dismiss step required. The result itself has no visible
        text banner — it's carried by the board treatment plus the aria-live
        announcement — just a single, clearly-labelled Rematch action.
      */}
      {isGameOver ? (
        <div className={styles.resultActions}>
          <Button ref={rematchButtonRef} variant="primary" onClick={rematch}>
            <span className={styles.rematchIcon} aria-hidden="true">
              ↻
            </span>
            Rematch
          </Button>

          {onPlayAgain && playAgainPresets.length > 0 ? (
            <div className={styles.playAgainGroup} role="group" aria-labelledby={playAgainHeadingId}>
              <span id={playAgainHeadingId} className={styles.playAgainLabel}>
                or play again vs…
              </span>
              <div className={styles.playAgainButtons}>
                {playAgainPresets.map((preset) => {
                  const { icon, label } = PLAY_AGAIN_PRESET_COPY[preset];
                  return (
                    <Button
                      key={preset}
                      variant="secondary"
                      size="sm"
                      onClick={() => onPlayAgain(presetSeats(preset, seats.length))}
                    >
                      <span aria-hidden="true">{icon}</span> {label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* MPG-047: full-viewport confetti on a win — rendered at the top level
          so its fixed positioning isn't trapped by a transformed ancestor. */}
      {isGameOver && tone === "celebrate" ? <ConfettiBurst /> : null}
    </div>
  );
}
