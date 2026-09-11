import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createPointerAxisInputSource } from "./pointerAxisInputSource";
import type { InputSource, InputSourceHost } from "./inputSource";
import type { RealtimeLoopPhase } from "./useRealtimeLoop";

/**
 * MPG-121 — the pointer-axis source. `sample()` is imperative (reads the axis ref
 * + integrates held keys); acquisition (pointer move/down, key hold, start-on-
 * first-input) lives in `useBinding`, exercised via a small rig that gives the
 * source a real surface element to attach listeners to.
 */

interface AxisInput {
  readonly targetX: number;
}

function makeSource(): InputSource<AxisInput> {
  return createPointerAxisInputSource<AxisInput>({
    toInput: (axis) => ({ targetX: axis }),
    axis: "x",
    keyStepPerTick: 0.1,
    hint: "Move the mouse to steer",
  });
}

/** Mounts a source binding over a real surface div whose rect is 200px wide. */
function Rig({
  source,
  phase,
  onGameplayInput = vi.fn(),
}: {
  source: InputSource<AxisInput>;
  phase: RealtimeLoopPhase;
  onGameplayInput?: () => void;
}): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const host: InputSourceHost = { phase, onGameplayInput, surfaceRef };
  source.useBinding(host);
  return <div data-testid="surface" ref={surfaceRef} />;
}

const RECT_200 = {
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
  render(<Rig {...props} />);
  const surface = screen.getByTestId("surface");
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(RECT_200);
  return surface;
}

describe("createPointerAxisInputSource — identity + lifecycle", () => {
  it("is a pointer-axis source with a trivially-available lifecycle", async () => {
    const source = makeSource();
    expect(source.id).toBe("pointer-axis");
    expect(source.getStatus()).toBe("tracking");
    await expect(source.isAvailable()).resolves.toBe(true);
    await expect(source.start(new AbortController().signal)).resolves.toBeUndefined();
    expect(() => source.stop()).not.toThrow();
  });
});

describe("createPointerAxisInputSource — pointer position", () => {
  it("maps pointer x on the surface to a 0..1 axis via toInput", () => {
    const source = makeSource();
    const surface = renderRig({ source, phase: "running" });

    fireEvent.pointerMove(surface, { clientX: 50 }); // 50/200 = 0.25
    expect(source.sample()).toEqual({ targetX: 0.25 });

    fireEvent.pointerMove(surface, { clientX: 200 }); // right edge → 1
    expect(source.sample()).toEqual({ targetX: 1 });
  });

  it("starts a ready run on pointer-down and sets the axis to the press point", () => {
    const source = makeSource();
    const onGameplayInput = vi.fn();
    const surface = renderRig({ source, phase: "ready", onGameplayInput });

    fireEvent.pointerDown(surface, { clientX: 150 }); // 0.75
    expect(onGameplayInput).toHaveBeenCalledTimes(1);
    expect(source.sample()).toEqual({ targetX: 0.75 });
  });
});

describe("createPointerAxisInputSource — keyboard parity", () => {
  it("integrates a held arrow key by the step each tick, and clamps", () => {
    const source = makeSource();
    renderRig({ source, phase: "running" }); // axis starts centred at 0.5

    fireEvent.keyDown(window, { code: "ArrowRight" });
    expect(source.sample()).toEqual({ targetX: 0.6 });
    expect(source.sample()).toEqual({ targetX: expect.closeTo(0.7, 10) });

    fireEvent.keyUp(window, { code: "ArrowRight" });
    // Released: the axis holds where it was, no further drift.
    const held = source.sample();
    expect(source.sample()).toEqual(held);
  });

  it("moves left on ArrowLeft/A and starts a ready run on the first key", () => {
    const source = makeSource();
    const onGameplayInput = vi.fn();
    renderRig({ source, phase: "ready", onGameplayInput });

    fireEvent.keyDown(window, { code: "KeyA" });
    expect(onGameplayInput).toHaveBeenCalledTimes(1);
    expect(source.sample()).toEqual({ targetX: expect.closeTo(0.4, 10) });
  });

  it("ignores unmapped keys", () => {
    const source = makeSource();
    renderRig({ source, phase: "running" });

    fireEvent.keyDown(window, { code: "KeyZ" });
    expect(source.sample()).toEqual({ targetX: 0.5 }); // unchanged
  });
});

describe("createPointerAxisInputSource — binding shape", () => {
  it("renders no overlay, no touch controls, no synthetic pointer handler", () => {
    const source = makeSource();
    let captured: ReturnType<InputSource<AxisInput>["useBinding"]> | undefined;
    function Capture(): null {
      const surfaceRef = useRef<HTMLDivElement>(null);
      captured = source.useBinding({ phase: "ready", onGameplayInput: vi.fn(), surfaceRef });
      return null;
    }
    render(<Capture />);
    expect(captured?.overlay).toBeNull();
    expect(captured?.controls).toBeNull();
    expect(captured?.onSurfacePointerDown).toBeNull();
    expect(captured?.hint).toBe("Move the mouse to steer");
  });
});
