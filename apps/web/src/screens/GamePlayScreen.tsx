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
 * The emotional register of the terminal state (MPG-044/051). A draw is
 * always "neutral". For a win, the tone depends on perspective:
 *
 * - **Local (shared-screen) play** — `viewerSeat` is `null`, the default and
 *   the only mode wired up today. There's no single "viewer": every seat is
 *   visible on one shared device, so wins are celebratory by default (a win
 *   is a win — human-vs-human, all-bot watch, or a human beating a bot).
 *   "Lose" framing is reserved for the one configuration where it's
 *   unambiguous: a single local human seat that did NOT win — that reads as
 *   a somber "subdued" defeat rather than a neutral/celebratory "X wins!".
 * - **Remote (networked 1v1) play** — `viewerSeat` identifies which seat
 *   *this* client is playing. Every remote client has its own unambiguous
 *   stake in the outcome, so the tone is simply "celebrate" if `viewerSeat`
 *   won and "subdued" otherwise. This branch is NOT wired to any call site
 *   yet (no remote/networked mode exists in the client today) — it exists so
 *   the eventual remote integration (Phase 2) doesn't have to touch this
 *   function, and so it's covered by unit tests now.
 *
 * Note the crown (who *won*, rendered on `SeatCard`) is independent of tone —
 * it's computed separately in the render below and shown for every win,
 * regardless of tone.
 */
type ResultTone = "celebrate" | "subdued" | "neutral";

export function resultTone(
  result: Result,
  seats: SeatsConfig,
  viewerSeat: number | null = null,
): ResultTone {
  if (result.status !== "win") return "neutral"; // draw / in_progress

  if (viewerSeat !== null) {
    // Remote perspective (Phase 2, not yet wired): this client's own seat won or lost.
    return seatIndexOf(result.winner) === viewerSeat ? "celebrate" : "subdued";
  }

  // Local shared-screen perspective.
  const humanSeatIndices = seats.reduce<number[]>((acc, seat, index) => {
    if (seat.kind === "human") acc.push(index);
    return acc;
  }, []);
  if (humanSeatIndices.length === 1) {
    const [soleHumanIndex] = humanSeatIndices;
    if (seatIndexOf(result.winner) !== soleHumanIndex) return "subdued";
  }
  return "celebrate";
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

const ASH_COUNT = 30;

/**
 * A slow, grey "ashfall" (tone === "subdued") — the somber mirror of the
 * winner's confetti: desaturated flecks drift down across the whole viewport,
 * fewer/slower/dimmer than confetti, no bright hues. Same pure-CSS,
 * index-derived approach (no Math.random, so it's stable across
 * re-renders/tests). Decorative only (`aria-hidden`); the outcome is announced
 * via the live region.
 */
function AshFall(): React.JSX.Element {
  return (
    <div className={styles.ashLayer} aria-hidden="true">
      {Array.from({ length: ASH_COUNT }, (_, i) => {
        const vars: ConfettiVars = {
          "--x": `${(i * 41) % 100}%`,
          "--delay": `${(i % 10) * 140}ms`,
          "--duration": `${4200 + (i % 5) * 360}ms`,
          "--drift": `${((i * 29) % 60) - 30}px`,
          "--scale": `${0.55 + ((i * 17) % 55) / 100}`,
          "--shade": `${58 + ((i * 23) % 26)}%`,
        };
        return <span key={i} className={styles.ashPiece} style={vars} />;
      })}
    </div>
  );
}

/**
 * Defeat "gloom" (tone === "subdued") — replaces the earlier cracked-glass
 * treatment, which read as a broken screen/error rather than a loss. A dark
 * vignette closes in from the board edges (the light draining out) while the
 * board gives one heavy downward "sink" (`.boardSink` on the wrap); the winning
 * line is recolored red by the board itself, and grey ash (`AshFall`, rendered
 * viewport-wide at the top level) drifts down. Decorative only (`aria-hidden`);
 * reduced-motion settles to the final vignette instantly, no sink.
 */
function DefeatGloom(): React.JSX.Element {
  return <div className={styles.loseVeil} aria-hidden="true" />;
}

/**
 * Draw "stalemate" (tone === "neutral") — the previously-empty draw case now
 * gets its own signal: two neutral bars slide in from opposite edges and meet
 * dead-center, where a soft pulse blooms — two evenly-matched sides deadlocked,
 * no winner. Symmetric by construction, so it can't read as either side
 * prevailing. Decorative only (`aria-hidden`); reduced-motion shows the met
 * state instantly.
 */
function DrawStalemate(): React.JSX.Element {
  return (
    <div className={styles.drawStalemate} aria-hidden="true">
      <span className={cx(styles.drawBar, styles.drawBarLeft)} />
      <span className={cx(styles.drawBar, styles.drawBarRight)} />
      <span className={styles.drawSpark} />
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

  // MPG-051: the crown marks who won, independent of tone/celebration — shown
  // for every win, in every mode (including the "subdued" defeat case, where
  // the winning bot still gets its crown). No crown on a draw.
  const winnerSeatIndex =
    session.result.status === "win" ? seatIndexOf(session.result.winner) : null;

  const renderSeatCard = (seat: (typeof seats)[number], indexInSeats: number): ReactNode => (
    <SeatCard
      key={indexInSeats}
      seatIndex={indexInSeats}
      kind={seat.kind}
      active={!isGameOver && turnSeatIndex === indexInSeats}
      thinking={thinkingSeatIndex === indexInSeats}
      winner={winnerSeatIndex === indexInSeats}
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
      <div className={styles.seatRow}>{seats.map((seat, i) => renderSeatCard(seat, i))}</div>

      <div className={cx(styles.boardWrap, isGameOver && tone === "subdued" && styles.boardSink)}>
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
        {isGameOver && tone === "celebrate" ? (
          <div className={styles.winFlash} aria-hidden="true" />
        ) : null}
        {isGameOver && tone === "subdued" ? <DefeatGloom /> : null}
        {isGameOver && tone === "neutral" ? <DrawStalemate /> : null}
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
            <div
              className={styles.playAgainGroup}
              role="group"
              aria-labelledby={playAgainHeadingId}
            >
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

      {/* Full-viewport particle layers on a terminal state — rendered at the
          top level so their fixed positioning isn't trapped by a transformed
          ancestor: confetti on a win, the somber ashfall on a loss. */}
      {isGameOver && tone === "celebrate" ? <ConfettiBurst /> : null}
      {isGameOver && tone === "subdued" ? <AshFall /> : null}
    </div>
  );
}
