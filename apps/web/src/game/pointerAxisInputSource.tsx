import { useEffect } from "react";
import type { InputBinding, InputSource, InputSourceHost } from "./inputSource";

/**
 * MPG-121 (ADR 0008 §5) — the `pointer-axis` input source: a continuous 0..1 axis
 * driven by pointer POSITION (mouse hover / touch drag on the play surface), with
 * arrow-key parity. It's the second implementation of the MPG-120 `InputSource`
 * seam — evidence the seam generalises past discrete actions — and the permanent
 * bottom rung of the vision fallback ladder (a game must stay playable, scored,
 * and leaderboard-eligible with no camera; Playwright can drive a pointer/keys but
 * never a webcam).
 *
 * The axis is read once per fixed tick by `sample()` (synchronous, ADR §2): the
 * pointer writes the latest fraction into a ref on its own cadence, and keyboard
 * holds integrate at a fixed step per tick — so both replay identically from the
 * recorded input log and the sim is never coupled to pointer event rate.
 */

export interface PointerAxisConfig<I> {
  /** Map the current axis fraction (0..1) to the module's per-tick input. */
  readonly toInput: (axis: number) => I;
  /** Which surface dimension the pointer maps to. `x` → left..right, `y` → top..bottom. */
  readonly axis: "x" | "y";
  /** How far a held arrow key moves the axis each tick (fraction of the range). */
  readonly keyStepPerTick: number;
  /** Short control hint shown on the ready overlay + as the persistent caption. */
  readonly hint: string;
  /** Optional longer explainer shown once on the ready overlay. */
  readonly readyExplainer?: string;
  /** Player-facing source label. */
  readonly label?: string;
  /** Starting axis value (default centred, 0.5). */
  readonly initialAxis?: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** `KeyboardEvent.code`s that push the axis toward 0 and toward 1, per axis. */
function keySets(axis: "x" | "y"): { decrease: Set<string>; increase: Set<string> } {
  return axis === "x"
    ? { decrease: new Set(["ArrowLeft", "KeyA"]), increase: new Set(["ArrowRight", "KeyD"]) }
    : { decrease: new Set(["ArrowUp", "KeyW"]), increase: new Set(["ArrowDown", "KeyS"]) };
}

export function createPointerAxisInputSource<I>(config: PointerAxisConfig<I>): InputSource<I> {
  const { decrease, increase } = keySets(config.axis);
  // Live axis (0..1), shared between the binding (which writes it from pointer +
  // key events) and `sample()` (which reads + integrates it). A plain closure ref
  // so it is stable across the screen's re-renders.
  const axisRef = { current: clamp01(config.initialAxis ?? 0.5) };
  // Currently-held direction keys, tracked so a hold moves the axis every tick.
  const held = new Set<string>();

  const sample = (): I => {
    let dir = 0;
    for (const code of held) {
      if (increase.has(code)) dir += 1;
      if (decrease.has(code)) dir -= 1;
    }
    if (dir !== 0)
      axisRef.current = clamp01(axisRef.current + Math.sign(dir) * config.keyStepPerTick);
    return config.toInput(axisRef.current);
  };

  function useBinding(host: InputSourceHost): InputBinding {
    const surfaceRef = host.surfaceRef;

    // Pointer acquisition: hover/drag over the surface sets the axis directly, so
    // the character sits exactly where you point. A pointer-DOWN also starts a
    // `ready` run (a deliberate press, not a passing hover).
    useEffect(() => {
      const el = surfaceRef.current;
      if (!el) return;

      const axisFrom = (e: PointerEvent): number => {
        const rect = el.getBoundingClientRect();
        if (config.axis === "x") {
          return rect.width > 0 ? clamp01((e.clientX - rect.left) / rect.width) : 0.5;
        }
        return rect.height > 0 ? clamp01((e.clientY - rect.top) / rect.height) : 0.5;
      };

      const onMove = (e: PointerEvent): void => {
        axisRef.current = axisFrom(e);
      };
      const onDown = (e: PointerEvent): void => {
        // A press on an overlay button (Start / Resume / Play again) is that
        // button's job — don't also treat it as a gameplay start.
        if (e.target instanceof Element && e.target.closest("button")) return;
        axisRef.current = axisFrom(e);
        host.onGameplayInput();
      };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerdown", onDown);
      return () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerdown", onDown);
      };
    }, [surfaceRef, host]);

    // Keyboard parity: track held direction keys (integrated by `sample()`); the
    // first press also starts a `ready` run. A focused <button> keeps its own
    // activation keys, but arrows/WASD never activate a button, so we handle them
    // regardless of focus.
    useEffect(() => {
      const isDir = (code: string): boolean => decrease.has(code) || increase.has(code);
      const onKeyDown = (e: KeyboardEvent): void => {
        if (!isDir(e.code)) return;
        e.preventDefault();
        held.add(e.code);
        host.onGameplayInput();
      };
      const onKeyUp = (e: KeyboardEvent): void => {
        held.delete(e.code);
      };
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      return () => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
      };
    }, [host]);

    return {
      overlay: null,
      controls: null,
      // Pointer-down is handled by the native listener above (it needs the raw
      // event for geometry), so the screen wires no synthetic handler.
      onSurfacePointerDown: null,
      hint: config.hint,
      ...(config.readyExplainer !== undefined ? { readyExplainer: config.readyExplainer } : {}),
    };
  }

  return {
    id: "pointer-axis",
    label: config.label ?? "Mouse & keys",
    isAvailable: () => Promise.resolve(true),
    start: () => Promise.resolve(),
    stop: () => {},
    sample,
    getStatus: () => "tracking",
    useBinding,
  };
}
