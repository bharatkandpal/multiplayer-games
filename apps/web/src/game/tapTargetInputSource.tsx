import { useCallback, useEffect, useState } from "react";
import type { InputBinding, InputSource, InputSourceHost } from "./inputSource";
import styles from "./tapTargetInputSource.module.css";

/**
 * MPG-142 — the `tap-target` input source: a discrete tap at a normalised
 * POSITION over the play surface (`{x, y}`, each 0..1), with full keyboard
 * parity via a moveable grid cursor.
 *
 * The third implementation of the MPG-120 `InputSource` seam, after `actions`
 * and `pointer-axis`, and the first that reports a two-dimensional value. It is
 * an ADDITION to the seam, not a special case inside it: the loop, the play
 * screen, and every existing game are untouched.
 *
 * Two properties are load-bearing:
 *
 *   1. *A tap is a rising edge.* `sample()` consumes the pending tap and clears
 *      it, so one press produces exactly one input on exactly one tick — the sim
 *      can never see a held finger as a burst of taps.
 *   2. *Position is normalised at the seam, not in the game.* The source reports
 *      a fraction of the surface; what that fraction MEANS (which cell, which
 *      target) is a rule and belongs to the engine module. That's what lets a
 *      game change its grid without touching this file.
 *
 * **Keyboard parity is a real path, not a token one.** Arrows/WASD move a visible
 * cursor over the grid and Space/Enter taps the cell under it. This is a genuinely
 * different game to play — aiming with a cursor is slower than aiming with a
 * finger — and the honest framing is that it keeps the game *playable* without a
 * pointer rather than *equivalent* without one. That difference is named in the
 * game's own copy rather than papered over here.
 */

export interface TapTargetConfig<I> {
  /** Map a tap (or its absence) to the module's per-tick input. */
  readonly toInput: (tap: { x: number; y: number } | null) => I;
  /** Grid the KEYBOARD cursor steps over. Pointer taps are continuous and ignore it. */
  readonly cols: number;
  readonly rows: number;
  /** Short control hint shown on the ready overlay + as the persistent caption. */
  readonly hint: string;
  /** Optional longer explainer shown once on the ready overlay. */
  readonly readyExplainer?: string;
  /** Player-facing source label. */
  readonly label?: string;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Arrow/WASD codes → a cursor step, and the keys that fire a tap. */
const STEPS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
};
const FIRE_KEYS = new Set(["Space", "Enter"]);

export function createTapTargetInputSource<I>(config: TapTargetConfig<I>): InputSource<I> {
  // The tap awaiting the next tick. A plain closure ref so it stays stable across
  // the screen's re-renders, exactly like the other sources' mutable state.
  const pending: { current: { x: number; y: number } | null } = { current: null };

  const sample = (): I => {
    const tap = pending.current;
    pending.current = null; // consumed — one press, one tick
    return config.toInput(tap);
  };

  function useBinding(host: InputSourceHost): InputBinding {
    const { surfaceRef } = host;
    // The keyboard cursor. React state (not a ref) because the overlay has to
    // re-render when it moves — and `null` until a key is actually used, so a
    // pointer player never sees a cursor they didn't ask for.
    const [cursor, setCursor] = useState<{ col: number; row: number } | null>(null);

    const fireAt = useCallback(
      (x: number, y: number): void => {
        pending.current = { x: clamp01(x), y: clamp01(y) };
        host.onGameplayInput();
      },
      [host],
    );

    // Pointer taps: a press anywhere on the surface is a tap at that point.
    useEffect(() => {
      const el = surfaceRef.current;
      if (!el) return;

      const onDown = (e: PointerEvent): void => {
        // A press on an overlay button (Start / Resume / Play again) is that
        // button's job — don't also fire a gameplay tap under it.
        if (e.target instanceof Element && e.target.closest("button")) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        fireAt((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      };

      el.addEventListener("pointerdown", onDown);
      return () => el.removeEventListener("pointerdown", onDown);
    }, [surfaceRef, fireAt]);

    // Keyboard: arrows/WASD move the cursor, Space/Enter taps under it.
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent): void => {
        // Auto-repeat is the OS repeating a key nobody pressed again; a held
        // Space must not machine-gun taps (every one of which is a miss).
        if (e.repeat) return;

        const step = STEPS[e.code];
        if (step !== undefined) {
          e.preventDefault();
          setCursor((prev) => {
            // First key press just reveals the cursor at the centre — it does
            // not also move it, or the cursor appears somewhere the player
            // didn't aim for.
            if (prev === null) {
              return { col: Math.floor(config.cols / 2), row: Math.floor(config.rows / 2) };
            }
            return {
              col: Math.max(0, Math.min(config.cols - 1, prev.col + step[0])),
              row: Math.max(0, Math.min(config.rows - 1, prev.row + step[1])),
            };
          });
          // Moving the cursor starts a `ready` run: the player is clearly
          // playing, and making them find the Start button first would be rude.
          host.onGameplayInput();
          return;
        }

        if (!FIRE_KEYS.has(e.code)) return;
        // A focused <button> keeps its own activation keys (Space/Enter fire
        // Start / Resume / Play again) — those must not become gameplay taps.
        if (document.activeElement instanceof HTMLButtonElement) return;
        e.preventDefault();
        const at = cursor ?? {
          col: Math.floor(config.cols / 2),
          row: Math.floor(config.rows / 2),
        };
        setCursor(at);
        fireAt((at.col + 0.5) / config.cols, (at.row + 0.5) / config.rows);
      };

      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [host, fireAt, cursor]);

    const overlay =
      cursor === null ? null : (
        <div
          className={styles.cursor}
          style={{
            left: `${(cursor.col / config.cols) * 100}%`,
            top: `${(cursor.row / config.rows) * 100}%`,
            width: `${100 / config.cols}%`,
            height: `${100 / config.rows}%`,
          }}
        />
      );

    return {
      overlay,
      controls: null,
      // Pointer-down is handled by the native listener above (it needs the raw
      // event for geometry), so the screen wires no synthetic handler.
      onSurfacePointerDown: null,
      hint: config.hint,
      ...(config.readyExplainer !== undefined ? { readyExplainer: config.readyExplainer } : {}),
    };
  }

  return {
    id: "tap-target",
    label: config.label ?? "Tap & keys",
    isAvailable: () => Promise.resolve(true),
    start: () => Promise.resolve(),
    stop: () => {},
    sample,
    getStatus: () => "tracking",
    useBinding,
  };
}
