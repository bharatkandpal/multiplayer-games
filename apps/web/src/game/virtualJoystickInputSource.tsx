import { useEffect, useState } from "react";
import type { InputBinding, InputSource, InputSourceHost } from "./inputSource";
import styles from "./virtualJoystickInputSource.module.css";

/**
 * MPG-143 — the `joystick` input source: a floating virtual controller driven by
 * the pointer's DIRECTION DELTA. Press anywhere on the play surface to plant a
 * joystick under your thumb; drag away from that anchor and the dominant axis of
 * the delta becomes a four-way heading. It's the fourth implementation of the
 * MPG-120 `InputSource` seam (after `actions`, `pointer-axis`, `tap-target`) and,
 * like the others, an addition — the loop, the play screen, and every other game
 * are untouched.
 *
 * Two properties are load-bearing:
 *
 *   1. *Direction is a HELD state, not a rising edge.* Unlike a swipe (one gesture,
 *      one action), the stick reports the heading it is currently pushed toward
 *      every tick. That suits a snake — which travels on its own and only ever
 *      needs "keep steering this way" — and lets the engine's own turn rules
 *      (reversal-reject, one-turn-per-cell) decide what a repeated heading means.
 *   2. *The anchor is where you pressed, not the surface centre.* A floating stick
 *      keeps the control under the thumb wherever it lands, so a small screen
 *      never forces a reach — and the delta is measured from that anchor, so the
 *      very first drag already steers.
 *
 * Keyboard parity is real: arrows/WASD set the same held heading and start a
 * `ready` run, so the game is fully playable — and leaderboard-eligible — with no
 * pointer at all (what Playwright drives).
 */

/** The four headings a joystick can be pushed toward. */
export type JoystickDir = "up" | "down" | "left" | "right";

export interface VirtualJoystickConfig<I> {
  /** Map the currently-held heading (or `null` when centred) to the module's per-tick input. */
  readonly toInput: (dir: JoystickDir | null) => I;
  /** `KeyboardEvent.code` → heading, for keyboard parity (arrows + WASD, typically). */
  readonly keyMap: Readonly<Record<string, JoystickDir>>;
  /** Short control hint shown on the ready overlay + as the persistent caption. */
  readonly hint: string;
  /** Optional longer explainer shown once on the ready overlay. */
  readonly readyExplainer?: string;
  /** Player-facing source label. */
  readonly label?: string;
  /**
   * How far (fraction of the surface's smaller side) the thumb must leave the
   * anchor before it registers as a heading — a dead zone that stops a jittery
   * finger from firing turns it didn't mean. Defaults to a small, forgiving value.
   */
  readonly deadZoneFraction?: number;
}

/** Live geometry the overlay draws — anchor and thumb, in surface-relative px. */
interface Stick {
  readonly baseX: number;
  readonly baseY: number;
  readonly thumbX: number;
  readonly thumbY: number;
}

const DEFAULT_DEAD_ZONE = 0.04; // ~4% of the surface — a couple of px of drift is ignored
/** Max thumb travel from the anchor, as a fraction of the surface's smaller side. */
const STICK_RADIUS_FRACTION = 0.14;

/** The dominant-axis heading of a delta, or `null` inside the dead zone. */
function headingOf(dx: number, dy: number, deadZonePx: number): JoystickDir | null {
  if (Math.hypot(dx, dy) < deadZonePx) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

export function createVirtualJoystickInputSource<I>(
  config: VirtualJoystickConfig<I>,
): InputSource<I> {
  // The currently-held heading — the single source of truth `sample()` reads.
  // A plain closure ref so it stays stable across the screen's re-renders.
  const dirRef: { current: JoystickDir | null } = { current: null };

  // The in-flight gesture's geometry. It lives in the SOURCE closure, not the
  // pointer effect, on purpose: drawing the thumb calls `setStick`, which
  // re-renders the screen and re-runs the effect — effect-local `let`s would be
  // wiped mid-drag. Stable closure state (like the axis source's ref) survives.
  const gesture = {
    pointerId: null as number | null,
    baseX: 0,
    baseY: 0,
    deadZonePx: 0,
    radiusPx: 0,
  };

  const sample = (): I => config.toInput(dirRef.current);

  function useBinding(host: InputSourceHost): InputBinding {
    const { surfaceRef } = host;
    // The joystick's on-screen geometry. React state (not a ref) so the overlay
    // re-renders as the thumb moves; `null` until a press, so a keyboard-only or
    // idle player never sees a control they didn't summon.
    const [stick, setStick] = useState<Stick | null>(null);

    // Pointer: press anchors the stick and starts a `ready` run; drag sets the
    // held heading from the delta; release re-centres the thumb and stops
    // steering (the snake keeps its heading — `null` just means "no new turn").
    useEffect(() => {
      const el = surfaceRef.current;
      if (!el) return;

      const localPoint = (e: PointerEvent): { x: number; y: number } => {
        const rect = el.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };

      const onDown = (e: PointerEvent): void => {
        // A press on an overlay button (Start / Resume / Play again) is that
        // button's job — don't also plant a joystick under it.
        if (e.target instanceof Element && e.target.closest("button")) return;
        const rect = el.getBoundingClientRect();
        const minSide = Math.min(rect.width, rect.height);
        if (minSide <= 0) return;
        gesture.pointerId = e.pointerId;
        el.setPointerCapture?.(e.pointerId);
        gesture.deadZonePx = minSide * (config.deadZoneFraction ?? DEFAULT_DEAD_ZONE);
        gesture.radiusPx = minSide * STICK_RADIUS_FRACTION;
        const p = localPoint(e);
        gesture.baseX = p.x;
        gesture.baseY = p.y;
        setStick({ baseX: p.x, baseY: p.y, thumbX: p.x, thumbY: p.y });
        host.onGameplayInput();
      };

      const onMove = (e: PointerEvent): void => {
        if (gesture.pointerId !== e.pointerId) return;
        const p = localPoint(e);
        const dx = p.x - gesture.baseX;
        const dy = p.y - gesture.baseY;
        const heading = headingOf(dx, dy, gesture.deadZonePx);
        if (heading !== null) dirRef.current = heading;
        // Clamp the drawn thumb to the stick's travel so the knob rides the ring
        // rather than flying off with the finger.
        const dist = Math.hypot(dx, dy);
        const scale = dist > gesture.radiusPx && dist > 0 ? gesture.radiusPx / dist : 1;
        setStick({
          baseX: gesture.baseX,
          baseY: gesture.baseY,
          thumbX: gesture.baseX + dx * scale,
          thumbY: gesture.baseY + dy * scale,
        });
      };

      const end = (e: PointerEvent): void => {
        if (gesture.pointerId !== e.pointerId) return;
        gesture.pointerId = null;
        dirRef.current = null; // let go → stop requesting turns; the snake coasts on
        setStick(null);
      };

      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
      return () => {
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", end);
        el.removeEventListener("pointercancel", end);
      };
    }, [surfaceRef, host]);

    // Keyboard parity: a mapped key sets the held heading and starts a `ready`
    // run. Held keys latch the heading (the snake keeps going that way), matching
    // the pointer's "held state" model — so there's no key-up handler to clear it.
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent): void => {
        const heading = config.keyMap[e.code];
        if (heading === undefined) return;
        // A focused <button> keeps its own activation keys; arrows/WASD never
        // activate a button, so steering keys are handled regardless of focus.
        if (document.activeElement instanceof HTMLButtonElement) return;
        e.preventDefault();
        dirRef.current = heading;
        host.onGameplayInput();
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [host]);

    const overlay =
      stick === null ? null : (
        <div className={styles.joystick} aria-hidden="true">
          <span
            className={styles.base}
            style={{ left: `${stick.baseX}px`, top: `${stick.baseY}px` }}
          />
          <span
            className={styles.thumb}
            style={{ left: `${stick.thumbX}px`, top: `${stick.thumbY}px` }}
          />
        </div>
      );

    return {
      overlay,
      controls: null,
      // Pointer-down is handled by the native listener above (it needs the raw
      // event for geometry and pointer capture), so the screen wires no handler.
      onSurfacePointerDown: null,
      hint: config.hint,
      ...(config.readyExplainer !== undefined ? { readyExplainer: config.readyExplainer } : {}),
    };
  }

  return {
    id: "joystick",
    label: config.label ?? "Joystick & keys",
    isAvailable: () => Promise.resolve(true),
    start: () => Promise.resolve(),
    stop: () => {},
    sample,
    getStatus: () => "tracking",
    useBinding,
  };
}
