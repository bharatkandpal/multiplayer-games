import { createRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import {
  createActionInputSource,
  type InputBinding,
  type InputSource,
  type InputSourceHost,
  type RealtimeControls,
} from "./inputSource";
import type { RealtimeLoopPhase } from "./useRealtimeLoop";

/**
 * MPG-120 — the discrete-action `InputSource`. `sample()` is imperative and
 * testable on its own; the acquisition (keyboard/tap → pressed set, phase
 * gating, start-on-first-input) lives in `useBinding`, exercised here via a tiny
 * host component. Parity with the old in-screen behaviour is asserted at the
 * screen level in `RealtimePlayScreen.test.tsx`; this file pins the seam itself.
 */

interface FlapInput {
  readonly flap: boolean;
}
const flapControls: RealtimeControls<FlapInput, "flap"> = {
  primaryAction: "flap",
  keyMap: { Space: "flap", ArrowUp: "flap" },
  toInput: (pressed) => ({ flap: pressed.has("flap") }),
  actionHint: "Tap, Space, or ↑ to flap",
};

/** Mounts a source's binding with a given host, capturing the binding it returns. */
function Harness({
  source,
  host,
  onBinding,
}: {
  source: InputSource<unknown>;
  host: InputSourceHost;
  onBinding?: (b: InputBinding) => void;
}): null {
  const binding = source.useBinding(host);
  onBinding?.(binding);
  return null;
}

function makeHost(
  phase: RealtimeLoopPhase,
  overrides: Partial<InputSourceHost> = {},
): InputSourceHost {
  return {
    phase,
    onGameplayInput: vi.fn(),
    surfaceRef: createRef<HTMLDivElement>() as RefObject<HTMLDivElement | null>,
    ...overrides,
  };
}

describe("createActionInputSource — lifecycle + identity", () => {
  it("reports a discrete-action identity and a trivially-available lifecycle", async () => {
    const source = createActionInputSource(flapControls);
    expect(source.id).toBe("actions");
    expect(source.getStatus()).toBe("tracking");
    await expect(source.isAvailable()).resolves.toBe(true);
    // start/stop are no-ops (input needs no acquisition) and must not throw.
    await expect(source.start(new AbortController().signal)).resolves.toBeUndefined();
    expect(() => source.stop()).not.toThrow();
  });
});

describe("createActionInputSource — sample() reads and clears", () => {
  it("returns the pressed input once, then an empty input on the next tick", () => {
    const source = createActionInputSource(flapControls);
    render(<Harness source={source} host={makeHost("running")} />);

    fireEvent.keyDown(window, { code: "Space" });
    expect(source.sample()).toEqual({ flap: true });
    // Rising-edge: the press is consumed, so the very next sample is idle.
    expect(source.sample()).toEqual({ flap: false });
  });
});

describe("createActionInputSource — phase-gated presses", () => {
  it("READY: the first input starts the run AND registers as a press", () => {
    const source = createActionInputSource(flapControls);
    const onGameplayInput = vi.fn();
    render(<Harness source={source} host={makeHost("ready", { onGameplayInput })} />);

    fireEvent.keyDown(window, { code: "Space" });
    expect(onGameplayInput).toHaveBeenCalledTimes(1);
    expect(source.sample()).toEqual({ flap: true });
  });

  it("RUNNING: a press feeds the tick but does not re-start the run", () => {
    const source = createActionInputSource(flapControls);
    const onGameplayInput = vi.fn();
    render(<Harness source={source} host={makeHost("running", { onGameplayInput })} />);

    fireEvent.keyDown(window, { code: "ArrowUp" });
    expect(onGameplayInput).not.toHaveBeenCalled();
    expect(source.sample()).toEqual({ flap: true });
  });

  it.each(["paused", "over"] as const)("%s: presses are ignored", (phase) => {
    const source = createActionInputSource(flapControls);
    const onGameplayInput = vi.fn();
    render(<Harness source={source} host={makeHost(phase, { onGameplayInput })} />);

    fireEvent.keyDown(window, { code: "Space" });
    expect(onGameplayInput).not.toHaveBeenCalled();
    expect(source.sample()).toEqual({ flap: false });
  });

  it("ignores unmapped keys entirely", () => {
    const source = createActionInputSource(flapControls);
    render(<Harness source={source} host={makeHost("running")} />);

    fireEvent.keyDown(window, { code: "KeyZ" });
    expect(source.sample()).toEqual({ flap: false });
  });
});

describe("createActionInputSource — binding shape", () => {
  it("passes the hint through and renders no overlay for a single-action game", () => {
    const source = createActionInputSource(flapControls);
    let binding: InputBinding | undefined;
    render(<Harness source={source} host={makeHost("ready")} onBinding={(b) => (binding = b)} />);
    expect(binding?.hint).toBe("Tap, Space, or ↑ to flap");
    expect(binding?.overlay).toBeNull();
    // Single-action game: the whole surface is the tap target, no touch buttons.
    expect(binding?.controls).toBeNull();
    expect(binding?.readyExplainer).toBeUndefined();
  });

  it("surfaces touch controls and a readyExplainer when the game declares them", () => {
    const twoAction: RealtimeControls<{ move: "left" | "right" | null }, "left" | "right"> = {
      primaryAction: "left",
      keyMap: { ArrowLeft: "left", ArrowRight: "right" },
      toInput: (p) => ({ move: p.has("left") ? "left" : p.has("right") ? "right" : null }),
      actionHint: "Tap left or right",
      readyExplainer: "Steer the paddle.",
      touchActions: [
        { action: "left", label: "◀" },
        { action: "right", label: "▶" },
      ],
    };
    const source = createActionInputSource(twoAction);
    let binding: InputBinding | undefined;
    render(<Harness source={source} host={makeHost("ready")} onBinding={(b) => (binding = b)} />);
    expect(binding?.controls).not.toBeNull();
    expect(binding?.readyExplainer).toBe("Steer the paddle.");
  });
});

describe("createActionInputSource — swipe gesture (MPG-074 bugfix)", () => {
  type Dir = "up" | "down" | "left" | "right";
  const swipeControls: RealtimeControls<{ swipe: Dir | null }, Dir> = {
    primaryAction: "up",
    keyMap: { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" },
    toInput: (p) => ({
      swipe: (["up", "down", "left", "right"] as const).find((d) => p.has(d)) ?? null,
    }),
    actionHint: "Swipe the board",
    resolveSwipeAction: (dx, dy) =>
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up",
  };

  it("does nothing on press-down alone — only the completed drag resolves a direction", () => {
    const source = createActionInputSource(swipeControls);
    let binding: InputBinding | undefined;
    render(<Harness source={source} host={makeHost("running")} onBinding={(b) => (binding = b)} />);
    binding?.onSurfacePointerDown?.({
      clientX: 100,
      clientY: 100,
      target: document.createElement("div"),
    } as unknown as ReactPointerEvent);
    // No pointerup yet — the drag hasn't finished, so nothing is pressed.
    expect(source.sample()).toEqual({ swipe: null });
  });

  it.each([
    ["right", 100, 100, 160, 105],
    ["left", 100, 100, 40, 95],
    ["down", 100, 100, 105, 160],
    ["up", 100, 100, 95, 40],
  ] as const)("a %s drag past the threshold presses %s", (want, x0, y0, x1, y1) => {
    const source = createActionInputSource(swipeControls);
    let binding: InputBinding | undefined;
    render(<Harness source={source} host={makeHost("running")} onBinding={(b) => (binding = b)} />);
    const onDown = binding?.onSurfacePointerDown;
    expect(onDown).toBeTruthy();
    // Fire directly through the binding's own handler (jsdom has no real
    // surface element here) then release via the window, exactly as the real
    // gesture does — release routinely lands off the element that started it.
    onDown?.({
      clientX: x0,
      clientY: y0,
      target: document.createElement("div"),
    } as unknown as ReactPointerEvent);
    fireEvent.pointerUp(window, { clientX: x1, clientY: y1 });
    expect(source.sample()).toEqual({ swipe: want });
  });

  it("a drag under the swipe threshold falls back to a tap (primaryAction)", () => {
    const source = createActionInputSource(swipeControls);
    let binding: InputBinding | undefined;
    render(<Harness source={source} host={makeHost("running")} onBinding={(b) => (binding = b)} />);
    binding?.onSurfacePointerDown?.({
      clientX: 100,
      clientY: 100,
      target: document.createElement("div"),
    } as unknown as ReactPointerEvent);
    fireEvent.pointerUp(window, { clientX: 105, clientY: 102 }); // well under 24px
    expect(source.sample()).toEqual({ swipe: "up" }); // primaryAction
  });

  it("a pointercancel (e.g. a scroll takeover) resolves nothing", () => {
    const source = createActionInputSource(swipeControls);
    let binding: InputBinding | undefined;
    render(<Harness source={source} host={makeHost("running")} onBinding={(b) => (binding = b)} />);
    binding?.onSurfacePointerDown?.({
      clientX: 100,
      clientY: 100,
      target: document.createElement("div"),
    } as unknown as ReactPointerEvent);
    fireEvent.pointerCancel(window);
    fireEvent.pointerUp(window, { clientX: 200, clientY: 100 }); // ignored — already settled
    expect(source.sample()).toEqual({ swipe: null });
  });
});
