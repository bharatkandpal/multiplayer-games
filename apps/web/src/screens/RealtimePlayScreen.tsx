import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { RealtimeModule } from "@mpg/engine";
import { Button, StatusBadge, VisuallyHidden } from "../components/ui";
import { cx } from "../components/ui/cx";
import {
  type RealtimeLoopPhase,
  type RunComplete,
  useRealtimeLoop,
} from "../game";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import styles from "./RealtimePlayScreen.module.css";

/**
 * MPG-040d — the shipped, arcade play surface (ADR 0002): the real-time
 * counterpart to `GamePlayScreen`, driven by `useRealtimeLoop` rather than the
 * turn-based session. It owns the four explicit states (ready / running /
 * paused / game-over), each with exactly one primary action, plus keyboard↔tap
 * input parity, visible focus, and `prefers-reduced-motion` handling per ADR §5.
 *
 * Engine- AND renderer-agnostic, exactly like `GamePlayScreen`: the concrete
 * per-game drawing is supplied by `renderScene` (the Floppy Birds Canvas/DOM
 * renderer + the id→{module,renderer} wiring land in MPG-040e). Input is
 * generalized through `controls`: a game maps its action union `A` to
 * keys/taps and to the module's per-tick input `I`, so a second game
 * (Lumberjack, MPG-041) drops in against the same screen unchanged.
 */

/** What the per-game renderer is handed each frame. Read-only view of the run. */
export interface RealtimeSceneProps<S> {
  state: S;
  phase: RealtimeLoopPhase;
  score: number;
  /** True when the user prefers reduced motion — drop decorative parallax/particles. */
  reducedMotion: boolean;
}

/** An on-screen touch control (used for games with more than one action, e.g. chop L/R). */
export interface TouchAction<A extends string> {
  readonly action: A;
  readonly label: string;
}

/**
 * Maps a game's abstract action union `A` (e.g. `"flap"`, or `"left" | "right"`)
 * onto concrete input: which keys trigger it, what a plain tap does, and how a
 * set of actions pressed since the last tick becomes the module's input `I`.
 * Keeping this game-supplied is what lets one screen serve every real-time game.
 */
export interface RealtimeControls<I, A extends string = string> {
  /** The action a plain tap / Space maps to — the single "primary" gameplay input. */
  readonly primaryAction: A;
  /** `KeyboardEvent.code` → action (e.g. `{ Space: "flap", ArrowUp: "flap" }`). */
  readonly keyMap: Readonly<Record<string, A>>;
  /** Build the next tick's input from the actions pressed since the last sample. */
  readonly toInput: (pressed: ReadonlySet<A>) => I;
  /** Short, plain-language control hint, e.g. "Tap, Space, or ↑ to flap". */
  readonly actionHint: string;
  /**
   * On-screen buttons for touch play. Omit for a single-action game — the whole
   * play surface is then the tap target. Supply one per action for multi-action
   * games so touch users get an unambiguous control per action.
   */
  readonly touchActions?: readonly TouchAction<A>[];
}

export interface RealtimePlayScreenProps<S, I, A extends string = string> {
  module: RealtimeModule<S, I>;
  gameTitle: string;
  /** Seed for the first run. Deterministic — tests pass a fixed value. */
  seed: number;
  controls: RealtimeControls<I, A>;
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
}

const HINT_ID_PREFIX = "rt-hint";

function defaultNextSeed(): number {
  return (Date.now() & 0xffff) || 1;
}

export function RealtimePlayScreen<S, I, A extends string = string>({
  module,
  gameTitle,
  seed,
  controls,
  renderScene,
  onExit,
  onRunComplete,
  nextSeed = defaultNextSeed,
  autoPauseOnBlur = true,
}: RealtimePlayScreenProps<S, I, A>): React.JSX.Element {
  const reducedMotion = usePrefersReducedMotion();

  // Rising-edge input: actions pressed (via key or tap) since the last tick,
  // consumed and cleared once per fixed tick by the controller.
  const pressedRef = useRef<Set<A>>(new Set());
  const sampleInput = useCallback((): I => {
    const input = controls.toInput(pressedRef.current);
    pressedRef.current.clear();
    return input;
    // `controls` is game-static; toInput reads the live set. Re-created on each
    // render is fine — the loop stores it in a ref and always calls the latest.
  }, [controls]);

  const { state, score, phase, start, pause, resume, restart } = useRealtimeLoop<S, I>({
    module,
    seed,
    sampleInput,
    ...(onRunComplete ? { onRunComplete } : {}),
    autoPauseOnBlur,
  });

  // The key/pointer handlers close over `phase`; a ref keeps them correct
  // without re-binding the window listener on every phase change.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // A gameplay press: starts a `ready` run (and counts as the first input, so a
  // tap both starts and flaps), or feeds the next tick while `running`. Ignored
  // while paused/over — those states are driven by their overlay buttons.
  const handlePress = useCallback(
    (action: A) => {
      if (phaseRef.current === "ready") {
        start();
        pressedRef.current.add(action);
      } else if (phaseRef.current === "running") {
        pressedRef.current.add(action);
      }
    },
    [start],
  );

  // Keyboard input (Space/Arrow parity with tap). We let a focused <button>
  // handle its own activation keys (Space/Enter fire Start/Resume/Play again),
  // and route every other mapped key into gameplay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (document.activeElement instanceof HTMLButtonElement) return;
      const action = controls.keyMap[e.code];
      if (action === undefined) return;
      e.preventDefault();
      handlePress(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls, handlePress]);

  const onSurfacePointerDown = useCallback(
    (e: ReactPointerEvent): void => {
      // Only a plain tap on the surface itself is the primary action; taps on
      // the overlay buttons bubble here but are handled by the button.
      if (e.target instanceof HTMLButtonElement) return;
      handlePress(controls.primaryAction);
    },
    [controls, handlePress],
  );

  const handlePlayAgain = useCallback(() => {
    restart(nextSeed());
  }, [restart, nextSeed]);

  // Focus the one primary action for each state, so keyboard/AT users always
  // land on the obvious next control (mirrors GamePlayScreen's rematch focus).
  const startBtnRef = useRef<HTMLButtonElement>(null);
  const resumeBtnRef = useRef<HTMLButtonElement>(null);
  const playAgainBtnRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === "ready") startBtnRef.current?.focus();
    else if (phase === "paused") resumeBtnRef.current?.focus();
    else if (phase === "over") playAgainBtnRef.current?.focus();
    else if (phase === "running") surfaceRef.current?.focus();
  }, [phase]);

  const isRunning = phase === "running";
  const hintId = `${HINT_ID_PREFIX}-${useId()}`;

  // A polite live region announces state transitions and the final score —
  // NOT every point (that would be noisy); the visible score readout carries
  // the running total as text (never motion-only), per ADR §5.
  const announcement = (() => {
    switch (phase) {
      case "ready":
        return `${gameTitle} ready. ${controls.actionHint} to start.`;
      case "running":
        return "Game started.";
      case "paused":
        return `Paused. Score ${score}.`;
      case "over":
        return `Game over. Final score ${score}.`;
    }
  })();

  return (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <Button variant="ghost" size="sm" onClick={onExit}>
          Home
        </Button>
        <h1 className={styles.heading}>{gameTitle}</h1>
      </div>

      {/* Score as text + a first-class Pause control (touch parity), always in
          the same slot so the layout never jumps between states. */}
      <div className={styles.statusRow}>
        <StatusBadge status={isRunning ? "success" : "neutral"}>
          Score <span className={styles.scoreValue}>{score}</span>
        </StatusBadge>
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
        onPointerDown={onSurfacePointerDown}
      >
        {renderScene({ state, phase, score, reducedMotion })}

        {phase !== "running" ? (
          <div className={styles.overlay}>
            {phase === "ready" ? (
              <div className={styles.overlayInner}>
                <p className={styles.overlayText}>{controls.actionHint}</p>
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
                <p className={styles.overlayTitle}>Game over</p>
                <p className={styles.overlayText}>
                  Final score: <strong>{score}</strong>
                </p>
                <Button ref={playAgainBtnRef} variant="primary" onClick={handlePlayAgain}>
                  <span className={styles.playAgainIcon} aria-hidden="true">
                    ↻
                  </span>
                  Play again
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* On-screen touch controls for multi-action games; single-action games
          use the whole surface as the tap target (no buttons rendered). */}
      {controls.touchActions && controls.touchActions.length > 0 ? (
        <div className={styles.touchControls} role="group" aria-label="Game controls">
          {controls.touchActions.map(({ action, label }) => (
            <Button
              key={action}
              variant="secondary"
              onPointerDown={(e) => {
                e.preventDefault();
                handlePress(action);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      ) : null}

      <p id={hintId} className={styles.hint}>
        {controls.actionHint}. Pause anytime.
      </p>

      <div aria-live="polite" role="status">
        <VisuallyHidden>{announcement}</VisuallyHidden>
      </div>
    </div>
  );
}
