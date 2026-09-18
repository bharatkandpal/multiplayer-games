import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createTapTargetInputSource } from "./tapTargetInputSource";
import type { InputBinding, InputSource, InputSourceHost } from "./inputSource";
import type { RealtimeLoopPhase } from "./useRealtimeLoop";

/**
 * MPG-142 — the `tap-target` source. `sample()` is imperative (consumes the
 * pending tap); acquisition (pointer-down geometry, the keyboard cursor,
 * start-on-first-input) lives in `useBinding`, exercised via a rig that gives the
 * source a real surface element to attach listeners to — the same shape as the
 * pointer-axis source's test.
 */

interface TapInput {
  readonly tap: { x: number; y: number } | null;
}

const COLS = 4;
const ROWS = 4;

function makeSource(): InputSource<TapInput> {
  return createTapTargetInputSource<TapInput>({
    toInput: (tap) => ({ tap }),
    cols: COLS,
    rows: ROWS,
    hint: "Tap the targets",
  });
}

let lastBinding: InputBinding | null = null;

function Rig({
  source,
  phase,
  onGameplayInput = vi.fn(),
}: {
  source: InputSource<TapInput>;
  phase: RealtimeLoopPhase;
  onGameplayInput?: () => void;
}): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const host: InputSourceHost = { phase, onGameplayInput, surfaceRef };
  const binding = source.useBinding(host);
  lastBinding = binding;
  return (
    <div data-testid="surface" ref={surfaceRef}>
      {binding.overlay}
    </div>
  );
}

// A 200 x 100 surface, so x and y scale differently and a bug that confuses the
// two axes shows up as a wrong number rather than as a coincidence.
const RECT = {
  left: 0,
  top: 0,
  right: 200,
  bottom: 100,
  width: 200,
  height: 100,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

function renderRig(props: Parameters<typeof Rig>[0]): HTMLElement {
  lastBinding = null;
  const { rerender } = render(<Rig {...props} />);
  const surface = screen.getByTestId("surface");
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(RECT);
  // Re-render so the listener effect runs with the mocked rect in place.
  rerender(<Rig {...props} />);
  return surface;
}

describe("tap-target input source — identity", () => {
  it("reports its own modality id", () => {
    expect(makeSource().id).toBe("tap-target");
  });

  it("is always available and needs no acquisition", async () => {
    const source = makeSource();
    await expect(source.isAvailable()).resolves.toBe(true);
    await expect(source.start(new AbortController().signal)).resolves.toBeUndefined();
    expect(source.getStatus()).toBe("tracking");
  });

  it("samples null when nothing has been tapped", () => {
    expect(makeSource().sample().tap).toBeNull();
  });
});

describe("tap-target input source — pointer", () => {
  it("reports a tap as a fraction of the surface, per axis", () => {
    const source = makeSource();
    const surface = renderRig({ source, phase: "running" });

    fireEvent.pointerDown(surface, { clientX: 50, clientY: 75 });
    expect(source.sample().tap).toEqual({ x: 0.25, y: 0.75 });
  });

  it("consumes the tap — one press is one tick, not a burst", () => {
    const source = makeSource();
    const surface = renderRig({ source, phase: "running" });

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 50 });
    expect(source.sample().tap).not.toBeNull();
    // The very next tick sees nothing: a held finger cannot machine-gun taps.
    expect(source.sample().tap).toBeNull();
  });

  it("clamps a tap that lands outside the surface", () => {
    const source = makeSource();
    const surface = renderRig({ source, phase: "running" });

    fireEvent.pointerDown(surface, { clientX: -40, clientY: 400 });
    expect(source.sample().tap).toEqual({ x: 0, y: 1 });
  });

  it("starts a ready run on the first tap", () => {
    const onGameplayInput = vi.fn();
    const source = makeSource();
    const surface = renderRig({ source, phase: "ready", onGameplayInput });

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 50 });
    expect(onGameplayInput).toHaveBeenCalled();
  });

  it("ignores a press on an overlay button — Start is Start, not a shot", () => {
    const source = makeSource();
    const surface = renderRig({ source, phase: "ready" });

    const button = document.createElement("button");
    surface.appendChild(button);
    fireEvent.pointerDown(button, { clientX: 100, clientY: 50 });

    expect(source.sample().tap).toBeNull();
  });
});

describe("tap-target input source — keyboard parity", () => {
  it("shows no cursor until a key is actually used", () => {
    const source = makeSource();
    renderRig({ source, phase: "running" });
    expect(lastBinding?.overlay).toBeNull();
  });

  it("reveals the cursor at the centre on the first key, without also moving it", () => {
    const source = makeSource();
    renderRig({ source, phase: "running" });

    fireEvent.keyDown(window, { code: "ArrowRight" });
    expect(lastBinding?.overlay).not.toBeNull();

    // Centre column of a 4-wide grid is index 2 → 50% across.
    fireEvent.keyDown(window, { code: "Space" });
    expect(source.sample().tap).toEqual({ x: (2 + 0.5) / COLS, y: (2 + 0.5) / ROWS });
  });

  it("moves the cursor with the arrows and fires at the cell under it", () => {
    const source = makeSource();
    renderRig({ source, phase: "running" });

    fireEvent.keyDown(window, { code: "ArrowRight" }); // reveals at (2,2)
    fireEvent.keyDown(window, { code: "ArrowRight" }); // → (3,2)
    fireEvent.keyDown(window, { code: "ArrowUp" }); // → (3,1)
    fireEvent.keyDown(window, { code: "Space" });

    expect(source.sample().tap).toEqual({ x: (3 + 0.5) / COLS, y: (1 + 0.5) / ROWS });
  });

  it("clamps the cursor at the edges instead of wrapping or escaping", () => {
    const source = makeSource();
    renderRig({ source, phase: "running" });

    fireEvent.keyDown(window, { code: "ArrowLeft" }); // reveals at (2,2)
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(window, { code: "ArrowLeft" });
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(window, { code: "ArrowUp" });
    fireEvent.keyDown(window, { code: "Enter" });

    expect(source.sample().tap).toEqual({ x: 0.5 / COLS, y: 0.5 / ROWS });
  });

  it("ignores auto-repeat — a held Space must not spray misses", () => {
    const source = makeSource();
    renderRig({ source, phase: "running" });

    fireEvent.keyDown(window, { code: "Space" });
    expect(source.sample().tap).not.toBeNull();

    fireEvent.keyDown(window, { code: "Space", repeat: true });
    expect(source.sample().tap).toBeNull();
  });

  it("leaves Space alone while a button has focus", () => {
    const source = makeSource();
    const surface = renderRig({ source, phase: "ready" });

    const button = document.createElement("button");
    surface.appendChild(button);
    button.focus();
    fireEvent.keyDown(window, { code: "Space" });

    // Space belongs to the focused Start button, not to the game.
    expect(source.sample().tap).toBeNull();
  });

  it("starts a ready run on the first cursor move", () => {
    const onGameplayInput = vi.fn();
    const source = makeSource();
    renderRig({ source, phase: "ready", onGameplayInput });

    fireEvent.keyDown(window, { code: "ArrowDown" });
    expect(onGameplayInput).toHaveBeenCalled();
  });
});
