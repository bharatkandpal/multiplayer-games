import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { RealtimeModule } from "@mpg/engine";
import {
  BackArrowIcon,
  Button,
  HomeIcon,
  ShareAction,
  StatusBadge,
  VisuallyHidden,
} from "../components/ui";
import { cx } from "../components/ui/cx";
import {
  type InputSource,
  type InputSourceHost,
  type RealtimeLoopPhase,
  type RunComplete,
  useRealtimeLoop,
} from "../game";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import styles from "./RealtimePlayScreen.module.css";

// `RealtimeControls`/`TouchAction` moved to the input seam (`game/inputSource`)
// in MPG-120 — they are the discrete-action source's config now, not the
// screen's only input concept. Re-exported here so existing import paths hold.
export type { RealtimeControls, TouchAction } from "../game";

/**
 * MPG-040d — the shipped, arcade play surface (ADR 0002): the real-time
 * counterpart to `GamePlayScreen`, driven by `useRealtimeLoop` rather than the
 * turn-based session. It owns the four explicit states (ready / running /
 * paused / game-over), each with exactly one primary action, plus keyboard↔tap
 * input parity, visible focus, and `prefers-reduced-motion` handling per ADR §5.
 *
 * Engine- AND renderer-agnostic, exactly like `GamePlayScreen`: the concrete
 * per-game drawing is supplied by `renderScene`. Input is generalized through
 * an `InputSource` (MPG-120, ADR 0008 §1): the screen samples the source once
 * per tick for the loop and renders the source's own controls/overlay/hint via
 * `useBinding`. Today's discrete-action path is `createActionInputSource`; a
 * pointer/keyboard axis and a camera source drop in against the same seam with
 * no change here.
 */

/** What the per-game renderer is handed each frame. Read-only view of the run. */
export interface RealtimeSceneProps<S> {
  state: S;
  phase: RealtimeLoopPhase;
  score: number;
  /** True when the user prefers reduced motion — drop decorative parallax/particles. */
  reducedMotion: boolean;
}

export interface RealtimePlayScreenProps<S, I> {
  module: RealtimeModule<S, I>;
  gameTitle: string;
  /** Seed for the first run. Deterministic — tests pass a fixed value. */
  seed: number;
  /**
   * How the run is controlled (MPG-120, ADR 0008 §1). The discrete-action
   * source (`createActionInputSource(controls)`) is today's only one; a
   * pointer/keyboard axis and a camera source slot in later against the same
   * seam with no change here. The screen consumes `sample()` for the loop and
   * `useBinding()` for the source's own controls/overlay/hint.
   */
  inputSource: InputSource<I>;
  renderScene: (props: RealtimeSceneProps<S>) => ReactNode;
  onExit: () => void;
  /** Fired once when a run ends (score + seed + input log) — leaderboard seam (ADR §4). */
  onRunComplete?: (result: RunComplete<I>) => void;
  /**
   * Seed for each subsequent "Play again". Defaults to a fresh pseudo-random
   * seed (varied layouts); tests inject a fixed function for determinism.
   */
  nextSeed?: () => number;
  /** Auto-pause when the tab is backgrounded (default true; ADR §5). */
  autoPauseOnBlur?: boolean;
  /**
   * Optional extra control overlaid in the play surface's top-right corner —
   * e.g. Drunk Walk's cog button opening its character-customization menu.
   * Lives inside the game area (over the canvas) rather than the page's top
   * bar, and stays available in every phase, stacked above the ready/paused/
   * game-over scrim so it's never hidden. Omit for games with nothing to
   * configure.
   */
  surfaceExtra?: ReactNode;
  /**
   * URL to offer on the game-over surface as a one-tap share (MPG-087). Omit
   * to hide the Share affordance entirely — better no button than one that
   * shares nothing.
   *
   * Today this is the game's own URL, so the share is "here's my score, here's
   * the game" (the Wordle shape: brag first, no CTA). When MPG-056 lands a
   * durable per-result link, this prop is the single place it swaps in — the
   * button, the fallback ladder, and the copy all stay put.
   */
  shareUrl?: string;
  /**
   * Optional extra content rendered on the game-over surface, below the share
   * affordance — e.g. the post-game leaderboard rank preview (MPG-055). Kept as
   * a slot rather than a leaderboard-aware prop so this screen stays generic:
   * it knows about run phases, not about leaderboards.
   */
  resultExtra?: ReactNode;
  /**
   * A score to beat — the challenge a player arrived on from someone else's
   * shared result (the "Beat this score" entry on `SharedResultScreen`). When
   * set, the screen shows a live `Target` readout, celebrates the moment the
   * player's score passes it, and turns the game-over line into a verdict
   * ("You beat the challenge" / "so close"). Omit for an ordinary solo run —
   * the whole affordance simply isn't there, so a normal run is untouched.
   *
   * There is no challenger name because results carry no handles yet (MPG-091);
   * the copy is deliberately about the *score*, and a name slots in later with
   * no change to the mechanic.
   */
  challengeTarget?: number;
}

const HINT_ID_PREFIX = "rt-hint";

function defaultNextSeed(): number {
  return Date.now() & 0xffff || 1;
}

export function RealtimePlayScreen<S, I>({
  module,
  gameTitle,
  seed,
  inputSource,
  renderScene,
  onExit,
  onRunComplete,
  nextSeed = defaultNextSeed,
  autoPauseOnBlur = true,
  surfaceExtra,
  shareUrl,
  resultExtra,
  challengeTarget,
}: RealtimePlayScreenProps<S, I>): React.JSX.Element {
  const reducedMotion = usePrefersReducedMotion();

  const { state, score, phase, start, pause, resume, restart } = useRealtimeLoop<S, I>({
    module,
    seed,
    // The loop's one input dependency: sample the source once per fixed tick.
    sampleInput: inputSource.sample,
    ...(onRunComplete ? { onRunComplete } : {}),
    autoPauseOnBlur,
  });

  // A ref keeps `startIfReady` correct for the source's handlers without
  // re-binding anything on every phase change.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Focus the one primary action for each state, so keyboard/AT users always
  // land on the obvious next control (mirrors GamePlayScreen's rematch focus).
  const startBtnRef = useRef<HTMLButtonElement>(null);
  const resumeBtnRef = useRef<HTMLButtonElement>(null);
  const playAgainBtnRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Starts a `ready` run on the source's first gameplay input; a no-op
  // otherwise. The source owns *how* an input is acquired; the screen owns the
  // run lifecycle it feeds into.
  const startIfReady = useCallback(() => {
    if (phaseRef.current === "ready") start();
  }, [start]);

  const host: InputSourceHost = { phase, onGameplayInput: startIfReady, surfaceRef };
  const binding = inputSource.useBinding(host);

  const handlePlayAgain = useCallback(() => {
    restart(nextSeed());
  }, [restart, nextSeed]);

  useEffect(() => {
    if (phase === "ready") startBtnRef.current?.focus();
    else if (phase === "paused") resumeBtnRef.current?.focus();
    else if (phase === "over") playAgainBtnRef.current?.focus();
    else if (phase === "running") surfaceRef.current?.focus();
  }, [phase]);

  const isRunning = phase === "running";
  const hintId = `${HINT_ID_PREFIX}-${useId()}`;

  // Challenge (MPG-087): a score to beat, carried in from a friend's shared
  // result. `passed` is the live "you're now ahead" fact; it drives both the
  // status chip and a one-time celebratory flash. All of it is inert when no
  // target was supplied — an ordinary solo run renders exactly as before.
  const hasTarget = typeof challengeTarget === "number";
  const passed = hasTarget && score > challengeTarget;
  // Latch the *first* crossing so the flash + its announcement fire once, not
  // every frame the player stays ahead. Reset at the top of each run (score
  // returns to 0 on start / "Play again"), so a rematch celebrates afresh.
  const passAnnouncedRef = useRef(false);
  const [showPassFlash, setShowPassFlash] = useState(false);
  useEffect(() => {
    if (score === 0) {
      passAnnouncedRef.current = false;
      setShowPassFlash(false);
      return;
    }
    if (passed && !passAnnouncedRef.current) {
      passAnnouncedRef.current = true;
      setShowPassFlash(true);
    }
  }, [score, passed]);

  // The flash is a moment, not a banner: it clears itself so it never sits over
  // the running scene. The persistent "Passed" chip (below) carries the state
  // afterwards, so nothing is lost when it goes — including for reduced-motion
  // users, who get the chip and the announcement but no animation.
  useEffect(() => {
    if (!showPassFlash) return;
    const timer = setTimeout(() => setShowPassFlash(false), 1600);
    return () => clearTimeout(timer);
  }, [showPassFlash]);

  // The game-over verdict, once a target is in play. Spoiler-free of *how* the
  // run went — just the comparison a challenge is about.
  const verdict = ((): { text: string; won: boolean } | null => {
    if (!hasTarget || phase !== "over") return null;
    if (score > challengeTarget) {
      return { text: `You beat the challenge — topped ${challengeTarget} by ${score - challengeTarget}.`, won: true };
    }
    if (score === challengeTarget) return { text: `Dead heat — you matched ${challengeTarget}.`, won: false };
    return { text: `So close — ${challengeTarget} to beat.`, won: false };
  })();

  // A polite live region announces state transitions and the final score —
  // NOT every point (that would be noisy); the visible score readout carries
  // the running total as text (never motion-only), per ADR §5.
  const announcement = (() => {
    switch (phase) {
      case "ready":
        return `${gameTitle} ready. ${binding.hint} to start.`;
      case "running":
        // Once the target is passed, the single live region carries that news
        // (constant text, so it announces once and doesn't repeat while ahead).
        return passed ? `You passed the target score of ${challengeTarget}.` : "Game started.";
      case "paused":
        return `Paused. Score ${score}.`;
      case "over":
        return `Game over. Final score ${score}.${verdict ? ` ${verdict.text}` : ""}`;
    }
  })();

  return (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <Button variant="ghost" size="sm" onClick={onExit} aria-label="Home">
          <span className={styles.homeIcons}>
            <BackArrowIcon />
            <HomeIcon />
          </span>
        </Button>
        <h1 className={styles.heading}>{gameTitle}</h1>
      </div>

      {/* Score as text + a first-class Pause control (touch parity), always in
          the same slot so the layout never jumps between states. */}
      <div className={styles.statusRow}>
        <StatusBadge status={isRunning ? "success" : "neutral"}>
          Score <span className={styles.scoreValue}>{score}</span>
        </StatusBadge>
        {hasTarget ? (
          <StatusBadge status={passed ? "success" : "neutral"}>
            {passed ? "Passed" : "Target"}{" "}
            <span className={styles.scoreValue}>{challengeTarget}</span>
            {passed ? <span aria-hidden="true"> ✦</span> : null}
          </StatusBadge>
        ) : null}
        {isRunning ? (
          <Button variant="secondary" size="sm" onClick={pause}>
            Pause
          </Button>
        ) : null}
      </div>

      <div
        ref={surfaceRef}
        className={cx(styles.surface, isRunning && styles.surfaceRunning)}
        role="application"
        aria-label={`${gameTitle} play area`}
        aria-describedby={hintId}
        tabIndex={0}
        onPointerDown={binding.onSurfacePointerDown ?? undefined}
      >
        {renderScene({ state, phase, score, reducedMotion })}

        {/* The one-time "you're ahead now" moment. Decorative and transient —
            the persistent chip and the announcement carry the fact — so it is
            aria-hidden and dropped entirely for reduced-motion. */}
        {showPassFlash && !reducedMotion ? (
          <div className={styles.passFlash} aria-hidden="true">
            Passed them! ✦
          </div>
        ) : null}

        {/* Source-owned in-surface UI (e.g. a camera preview / tracking dot for
            the vision source); `null` for the discrete-action source. */}
        {binding.overlay}

        {phase !== "running" ? (
          <div className={cx(styles.overlay, phase === "over" && styles.overlayOver)}>
            {phase === "ready" ? (
              <div className={styles.overlayInner}>
                <p className={styles.overlayText}>{binding.hint}</p>
                {binding.readyExplainer ? (
                  <p className={styles.overlayText}>{binding.readyExplainer}</p>
                ) : null}
                <Button ref={startBtnRef} variant="primary" onClick={start}>
                  Start
                </Button>
              </div>
            ) : null}

            {phase === "paused" ? (
              <div className={styles.overlayInner}>
                <p className={styles.overlayTitle}>Paused</p>
                <Button ref={resumeBtnRef} variant="primary" onClick={resume}>
                  Resume
                </Button>
              </div>
            ) : null}

            {phase === "over" ? (
              <div className={styles.overlayInner}>
                <p className={styles.overlayTitle}>{verdict?.won ? "You won the challenge!" : "Game over"}</p>
                <p className={styles.overlayText}>
                  Final score: <strong>{score}</strong>
                </p>
                {verdict ? (
                  <p className={cx(styles.verdict, verdict.won && styles.verdictWon)}>{verdict.text}</p>
                ) : null}
                <Button ref={playAgainBtnRef} variant="primary" onClick={handlePlayAgain}>
                  <span className={styles.playAgainIcon} aria-hidden="true">
                    ↻
                  </span>
                  Play again
                </Button>
                {shareUrl ? (
                  /* Secondary to "Play again" — one primary action per state
                     stays the rule; sharing is the optional brag on top. The
                     whole ladder (sheet → clipboard → visible URL) plus its
                     politely-announced feedback lives in `ShareAction`, shared
                     with the turn-based result actions so the two can't drift.
                     Brag-first text (PRD FR-23): the score leads, the link
                     follows, and there's no "Play now!" CTA. */
                  <ShareAction
                    url={shareUrl}
                    title={gameTitle}
                    text={
                      verdict?.won
                        ? `I beat the ${challengeTarget} challenge on ${gameTitle} — scored ${score}`
                        : `I scored ${score} on ${gameTitle}`
                    }
                    shareLabel={verdict?.won ? "Share your win" : "Share score"}
                  />
                ) : null}
                {resultExtra}
              </div>
            ) : null}
          </div>
        ) : null}

        {surfaceExtra ? <div className={styles.surfaceExtra}>{surfaceExtra}</div> : null}
      </div>

      {/* Source-owned on-screen touch controls (the action source's per-action
          buttons for a multi-action game); `null` for single-action games,
          which use the whole surface as the tap target. The screen owns the
          styled group wrapper so the layout stays identical across sources. */}
      {binding.controls ? (
        <div className={styles.touchControls} role="group" aria-label="Game controls">
          {binding.controls}
        </div>
      ) : null}

      <p id={hintId} className={styles.hint}>
        {binding.hint}. Pause anytime.
      </p>

      <div aria-live="polite" role="status">
        <VisuallyHidden>{announcement}</VisuallyHidden>
      </div>
    </div>
  );
}
