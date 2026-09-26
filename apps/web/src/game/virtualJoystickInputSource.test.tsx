import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createVirtualJoystickInputSource } from "./virtualJoystickInputSource";
import type { InputSource, InputSourceHost } from "./inputSource";
import type { RealtimeLoopPhase } from "./useRealtimeLoop";

/**
 * MPG-143 — the floating virtual-joystick source. `sample()` just reports the
 * held heading; acquisition (pointer anchor/drag/release, keyboard parity,
 * start-on-first-input) lives in `useBinding`, exercised over a real surface div
 * whose rect is stubbed to a known 200×100 so the delta geometry is deterministic.
 */

interface DirInput {
  readonly turn: "up" | "down" | "left" | "right" | null;
}

function makeSource(): InputSource<DirInput> {
  return createVirtualJoystickInputSource<DirInput>({
    toInput: (dir) => ({ turn: dir }),
    keyMap: {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      KeyA: "left",
    },
    hint: "Drag to steer",
    readyExplainer: "You can't turn back on yourself.",
  });
}

function Rig({
  source,
  phase,
  onGameplayInput = vi.fn(),
}: {
  source: InputSource<DirInput>;
  phase: RealtimeLoopPhase;
  onGameplayInput?: () => void;
}): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const host: InputSourceHost = { phase, onGameplayInput, surfaceRef };
  source.useBinding(host);
  return <div data-testid="surface" ref={surfaceRef} />;
}

// 200×100 → minSide 100, so deadZone = 4px, stick radius = 14px.
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
  render(<Rig {...props} />);
  const surface = screen.getByTestId("surface");
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(RECT);
  return surface;
}

describe("createVirtualJoystickInputSource — identity + lifecycle", () => {
  it("is a joystick source with a trivially-available lifecycle", async () => {
    const source = makeSource();
    expect(source.id).toBe("joystick");
    expect(source.getStatus()).toBe("tracking");
    await expect(source.isAvailable()).resolves.toBe(true);
    await expect(source.start(new AbortController().signal)).resolves.toBeUndefined();
    expect(() => source.stop()).not.toThrow();
    // Nothing held yet → no turn requested.
    expect(source.sample()).toEqual({ turn: null });
  });
});

describe("createVirtualJoystickInputSource — pointer steering", () => {
  it("anchors on press, starts a ready run, and holds the dominant-axis heading", () => {
    const source = makeSource();
    const onGameplayInput = vi.fn();
    const surface = renderRig({ source, phase: "ready", onGameplayInput });

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 50, pointerId: 1 });
    expect(onGameplayInput).toHaveBeenCalledTimes(1);
    // No drag yet → no heading.
    expect(source.sample()).toEqual({ turn: null });

    fireEvent.pointerMove(surface, { clientX: 140, clientY: 50, pointerId: 1 }); // dx +40 → right
    expect(source.sample()).toEqual({ turn: "right" });
    // The heading is HELD — every subsequent tick still reports it.
    expect(source.sample()).toEqual({ turn: "right" });

    fireEvent.pointerMove(surface, { clientX: 100, clientY: 90, pointerId: 1 }); // dy +40 → down
    expect(source.sample()).toEqual({ turn: "down" });
  });

  it("ignores a wobble inside the dead zone", () => {
    const source = makeSource();
    const surface = renderRig({ source, phase: "running" });

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 100, clientY: 90, pointerId: 1 }); // down
    fireEvent.pointerMove(surface, { clientX: 102, clientY: 50, pointerId: 1 }); // dx 2 < 4px dead zone
    expect(source.sample()).toEqual({ turn: "down" }); // unchanged
  });

  it("stops requesting turns on release (the snake coasts on)", () => {
    const source = makeSource();
    const surface = renderRig({ source, phase: "running" });

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 60, clientY: 50, pointerId: 1 }); // left
    expect(source.sample()).toEqual({ turn: "left" });

    fireEvent.pointerUp(surface, { clientX: 60, clientY: 50, pointerId: 1 });
    expect(source.sample()).toEqual({ turn: null });
  });
});

describe("createVirtualJoystickInputSource — keyboard parity", () => {
  it("sets the held heading on a mapped key and starts a ready run", () => {
    const source = makeSource();
    const onGameplayInput = vi.fn();
    renderRig({ source, phase: "ready", onGameplayInput });

    fireEvent.keyDown(window, { code: "KeyA" }); // → left
    expect(onGameplayInput).toHaveBeenCalledTimes(1);
    expect(source.sample()).toEqual({ turn: "left" });

    fireEvent.keyDown(window, { code: "ArrowUp" });
    expect(source.sample()).toEqual({ turn: "up" });
  });

  it("ignores unmapped keys", () => {
    const source = makeSource();
    renderRig({ source, phase: "running" });

    fireEvent.keyDown(window, { code: "KeyZ" });
    expect(source.sample()).toEqual({ turn: null });
  });
});

describe("createVirtualJoystickInputSource — binding shape", () => {
  it("exposes the hint/explainer and no touch controls or synthetic handler", () => {
    const source = makeSource();
    let captured: ReturnType<InputSource<DirInput>["useBinding"]> | undefined;
    function Capture(): null {
      const surfaceRef = useRef<HTMLDivElement>(null);
      captured = source.useBinding({ phase: "ready", onGameplayInput: vi.fn(), surfaceRef });
      return null;
    }
    render(<Capture />);
    // Idle (no press) → no joystick drawn yet.
    expect(captured?.overlay).toBeNull();
    expect(captured?.controls).toBeNull();
    expect(captured?.onSurfacePointerDown).toBeNull();
    expect(captured?.hint).toBe("Drag to steer");
    expect(captured?.readyExplainer).toBe("You can't turn back on yourself.");
  });
});
