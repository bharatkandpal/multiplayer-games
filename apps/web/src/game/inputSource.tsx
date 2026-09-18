import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "../components/ui";
import type { RealtimeLoopPhase } from "./useRealtimeLoop";

/**
 * MPG-120 (ADR 0008 §1) — the input seam for real-time games.
 *
 * `useRealtimeLoop` needs exactly one thing from input: `sample(): I`, called
 * once per fixed tick. Everything else — how the value is acquired (keys, taps,
 * a camera), the acquisition lifecycle (probe / start / fail / teardown), and
 * any in-surface UI — is the concern of an `InputSource`. Today's only source is
 * the discrete-action one (`createActionInputSource`); a `pointer-axis` and a
 * `vision-axis` source slot in later against this same interface, with no change
 * to the engine, the loop, or the existing games.
 */

/** An on-screen touch control (used for games with more than one action, e.g. chop L/R). */
export interface TouchAction<A extends string> {
  readonly action: A;
  readonly label: string;
}

/**
 * Maps a game's abstract action union `A` (e.g. `"flap"`, or `"left" | "right"`)
 * onto concrete input: which keys trigger it, what a plain tap does, and how a
 * set of actions pressed since the last tick becomes the module's input `I`.
 * This is the config for the discrete-action `InputSource`, not the screen's
 * only input concept — a continuous-axis source (ADR 0008) ignores it entirely.
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
   * Optional longer explainer shown once, only on the `ready` overlay, in
   * addition to `actionHint` — for a game whose mechanic isn't obvious from a
   * short hint alone (e.g. "tap the side OPPOSITE your lean; the same side
   * makes it worse"). Omit for a self-explanatory game like a single tap-to-act.
   */
  readonly readyExplainer?: string;
  /**
   * On-screen buttons for touch play. Omit for a single-action game — the whole
   * play surface is then the tap target. Supply one per action for multi-action
   * games so touch users get an unambiguous control per action.
   */
  readonly touchActions?: readonly TouchAction<A>[];
  /**
   * For a play surface split into tap zones (e.g. left half / right half),
   * resolves a plain tap's horizontal position — as a fraction of the surface
   * width, `0` (left edge) to `1` (right edge) — to the action it triggers.
   * Takes priority over `primaryAction` for plain taps on the surface; keyboard
   * input is unaffected (driven entirely by `keyMap`). Omit for a game where
   * every tap on the surface means the same thing.
   */
  readonly resolveTapAction?: (fractionX: number) => A;
  /**
   * For a drag/swipe-controlled game (e.g. 2048): resolves a completed pointer
   * drag on the play surface — `dx`/`dy` in pixels, end minus start — to the
   * action it triggers, or `null` to ignore it (e.g. a diagonal the game has no
   * action for). Only consulted once the drag clears {@link SWIPE_THRESHOLD_PX};
   * shorter movements fall through to `resolveTapAction`/`primaryAction` as a
   * plain tap. Takes priority over both for a surface press when present.
   */
  readonly resolveSwipeAction?: (dx: number, dy: number) => A | null;
}

/** Minimum drag distance (px) before a surface press counts as a swipe rather
 * than a tap — small enough to feel responsive, large enough to absorb the
 * finger drift a real touch swipe always has. */
const SWIPE_THRESHOLD_PX = 24;

/** Which control modality a source implements — part of the leaderboard key later (ADR §7). */
export type InputSourceId = "actions" | "pointer-axis" | "tap-target" | "vision-axis";

/** Liveness for the UI: acquiring / calibrating / tracking / lost / failed (ADR §1). */
export type InputSourceStatus =
  "idle" | "acquiring" | "calibrating" | "tracking" | "lost" | "failed";

/**
 * What the play screen hands a source's binding so the source can drive the run
 * without owning the loop: the live phase (to gate acquisition), a callback to
 * start a `ready` run on the first gameplay input, and the play-surface element
 * (for pointer geometry and, later, camera-preview overlay placement).
 */
export interface InputSourceHost {
  readonly phase: RealtimeLoopPhase;
  /** Called when a gameplay input occurs; starts the run if `ready`, else a no-op. */
  readonly onGameplayInput: () => void;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
}

/**
 * The render pieces a source contributes to the play screen's existing markup.
 * The screen owns *where* these go (so the DOM/CSS stays identical across
 * sources); the source owns *what* they are and the input semantics behind them.
 */
export interface InputBinding {
  /** Rendered inside the play surface — camera preview / tracking dot later; `null` for actions. */
  readonly overlay: ReactNode | null;
  /** On-screen touch controls (Button elements), wrapped by the screen; `null` if none. */
  readonly controls: ReactNode | null;
  /** Handler for a plain pointer-down on the play surface; `null` if the source ignores taps. */
  readonly onSurfacePointerDown: ((e: ReactPointerEvent) => void) | null;
  /** Short control hint — shown on the ready overlay and as the persistent caption. */
  readonly hint: string;
  /** Optional longer explainer shown once on the ready overlay. */
  readonly readyExplainer?: string;
}

/**
 * A sampler with a lifecycle (ADR 0008 §1). `sample()` is called once per fixed
 * tick and MUST be synchronous — for the vision source the tracker writes the
 * latest axis to a ref on its own cadence and `sample()` only reads it, so the
 * 60 Hz fixed-step determinism is never coupled to camera frame rate.
 */
export interface InputSource<I> {
  readonly id: InputSourceId;
  /** Player-facing, e.g. "Buttons & keys" or "Camera (hand)". */
  readonly label: string;
  /** Cheap capability probe. `false` → never offered in the picker. */
  isAvailable(): Promise<boolean>;
  /** Acquire resources (camera stream, model weights). Rejects → caller falls back. */
  start(signal: AbortSignal): Promise<void>;
  /** Release everything, synchronously. */
  stop(): void;
  /** Called exactly once per fixed tick. Synchronous and allocation-light. */
  sample(): I;
  getStatus(): InputSourceStatus;
  /** React binding: wires this source's acquisition and renders its own UI. */
  useBinding(host: InputSourceHost): InputBinding;
}

/**
 * The discrete-action input source — keyboard, plain taps, and on-screen touch
 * buttons, exactly as `RealtimePlayScreen` handled them before the seam existed.
 * It owns the rising-edge "pressed since last tick" set; `sample()` reads and
 * clears it. The lifecycle methods are trivial (input is always available, needs
 * no acquisition) — they exist so a camera source can implement the same shape.
 */
export function createActionInputSource<I, A extends string = string>(
  controls: RealtimeControls<I, A>,
): InputSource<I> {
  // Actions pressed (via key or tap) since the last tick — consumed and cleared
  // once per fixed tick by `sample()`. Lives in the source closure so it is
  // stable across the screen's re-renders, exactly like the old `pressedRef`.
  const pressed = new Set<A>();

  const sample = (): I => {
    const input = controls.toInput(pressed);
    pressed.clear();
    return input;
  };

  function useBinding(host: InputSourceHost): InputBinding {
    // The handlers close over `phase`/`onGameplayInput`; refs keep them correct
    // without re-binding the window listener on every phase change.
    const phaseRef = useRef(host.phase);
    phaseRef.current = host.phase;
    const onGameplayInputRef = useRef(host.onGameplayInput);
    onGameplayInputRef.current = host.onGameplayInput;
    const { surfaceRef } = host;

    // A gameplay press: on `ready` it starts the run (and counts as the first
    // input, so a tap both starts and flaps); on `running` it feeds the next
    // tick; ignored while paused/over (those are driven by their overlay buttons).
    const press = useCallback((action: A): void => {
      if (phaseRef.current === "ready") {
        onGameplayInputRef.current();
        pressed.add(action);
      } else if (phaseRef.current === "running") {
        pressed.add(action);
      }
    }, []);

    // Keyboard input (Space/Arrow parity with tap). We let a focused <button>
    // handle its own activation keys (Space/Enter fire Start/Resume/Play again),
    // and route every other mapped key into gameplay.
    useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
        if (document.activeElement instanceof HTMLButtonElement) return;
        // Auto-repeat is the OS repeating a key nobody pressed again. Holding
        // ArrowRight should be one action, not thirty a second — otherwise a
        // held key spams 2048 with moves and makes a Memory Sequence pad
        // register as a run of presses. A real second press fires a fresh
        // `keydown` with `repeat === false`, so nothing intentional is lost.
        if (e.repeat) return;
        const action = controls.keyMap[e.code];
        if (action === undefined) return;
        e.preventDefault();
        press(action);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [press]);

    // A tap that fell short of a swipe (or a swipe-less game): the pre-existing
    // resolution order — tap-zone first, else the single primary action.
    const pressAsTap = useCallback(
      (clientX: number): void => {
        if (controls.resolveTapAction) {
          const rect = surfaceRef.current?.getBoundingClientRect();
          const fractionX = rect && rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
          press(controls.resolveTapAction(fractionX));
          return;
        }
        press(controls.primaryAction);
      },
      [press, surfaceRef],
    );

    const onSurfacePointerDown = useCallback(
      (e: ReactPointerEvent): void => {
        // Only a plain tap on the surface itself triggers gameplay; taps on the
        // overlay buttons (Start/Resume/Play again) bubble here but are handled
        // by the button itself. `closest("button")` catches the button
        // regardless of which descendant (e.g. an icon span) was actually hit.
        if (e.target instanceof Element && e.target.closest("button")) return;

        if (controls.resolveSwipeAction) {
          // Drag-controlled game (2048): don't act on press-down — wait for the
          // gesture to finish (anywhere; a real thumb swipe routinely leaves the
          // surface before lifting), then classify by the full drag vector. A
          // window listener, not the surface's own pointerup, is what makes
          // "finger slid off the board" still resolve correctly on release.
          const startX = e.clientX;
          const startY = e.clientY;
          let settled = false;
          const finish = (endX: number, endY: number): void => {
            if (settled) return;
            settled = true;
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerCancel);
            const dx = endX - startX;
            const dy = endY - startY;
            if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_THRESHOLD_PX) {
              const action = controls.resolveSwipeAction?.(dx, dy) ?? null;
              if (action !== null) {
                press(action);
                return;
              }
            }
            // Too short (or an ignored direction) to be a swipe — treat the
            // release point as a plain tap.
            pressAsTap(endX);
          };
          const onPointerUp = (ev: PointerEvent): void => finish(ev.clientX, ev.clientY);
          const onPointerCancel = (): void => {
            settled = true;
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerCancel);
          };
          window.addEventListener("pointerup", onPointerUp);
          window.addEventListener("pointercancel", onPointerCancel);
          return;
        }

        pressAsTap(e.clientX);
      },
      [press, pressAsTap],
    );

    // On-screen touch controls for multi-action games; single-action games use
    // the whole surface as the tap target (no buttons rendered).
    const controlsNode =
      controls.touchActions && controls.touchActions.length > 0 ? (
        <>
          {controls.touchActions.map(({ action, label }) => (
            <Button
              key={action}
              variant="secondary"
              onPointerDown={(e) => {
                e.preventDefault();
                press(action);
              }}
            >
              {label}
            </Button>
          ))}
        </>
      ) : null;

    return {
      overlay: null,
      controls: controlsNode,
      onSurfacePointerDown,
      hint: controls.actionHint,
      ...(controls.readyExplainer !== undefined ? { readyExplainer: controls.readyExplainer } : {}),
    };
  }

  return {
    id: "actions",
    label: "Buttons & keys",
    isAvailable: () => Promise.resolve(true),
    start: () => Promise.resolve(),
    stop: () => {},
    sample,
    getStatus: () => "tracking",
    useBinding,
  };
}
