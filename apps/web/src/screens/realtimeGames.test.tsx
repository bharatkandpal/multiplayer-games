import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { drunkWalk, floppyBirds } from "@mpg/engine";
import { REALTIME_GAMES, RealtimeGameRoute } from "./realtimeGames";

// --- Controlled requestAnimationFrame (see RealtimePlayScreen.test.tsx) ------
let rafCb: FrameRequestCallback | null = null;
function frame(now: number): void {
  const cb = rafCb;
  rafCb = null;
  act(() => {
    cb?.(now);
  });
}

beforeEach(() => {
  rafCb = null;
  // jsdom has no 2D canvas; return null quietly (the renderer no-ops on it)
  // instead of letting jsdom log "getContext not implemented" for every frame.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCb = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    rafCb = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("REALTIME_GAMES wiring map", () => {
  it("resolves 'floppy-birds' to the real engine module + a renderer + controls", () => {
    const wiring = REALTIME_GAMES["floppy-birds"];
    expect(wiring).toBeDefined();
    expect(wiring!.module).toBe(floppyBirds);
    expect(wiring!.module.id).toBe("floppy-birds");
    expect(typeof wiring!.renderScene).toBe("function");
    expect(wiring!.controls.primaryAction).toBe("flap");
  });

  it("resolves 'drunk-walk' to the real engine module + a renderer + tap-zone controls", () => {
    const wiring = REALTIME_GAMES["drunk-walk"];
    expect(wiring).toBeDefined();
    expect(wiring!.module).toBe(drunkWalk);
    expect(wiring!.module.id).toBe("drunk-walk");
    expect(typeof wiring!.renderScene).toBe("function");
    // Left/right tap-zone resolution, not a single fixed primary action.
    expect(typeof wiring!.controls.resolveTapAction).toBe("function");
    const resolve = wiring!.controls.resolveTapAction!;
    expect(resolve(0.1)).toBe("left");
    expect(resolve(0.9)).toBe("right");
    // Keyboard parity: arrows AND A/D map to the same left/right actions.
    expect(wiring!.controls.keyMap.ArrowLeft).toBe("left");
    expect(wiring!.controls.keyMap.KeyA).toBe("left");
    expect(wiring!.controls.keyMap.ArrowRight).toBe("right");
    expect(wiring!.controls.keyMap.KeyD).toBe("right");
    // A rules explainer is offered — the mechanic isn't a trivial "tap to act".
    expect(wiring!.controls.readyExplainer).toBeTruthy();
  });
});

describe("RealtimeGameRoute — Floppy Birds end-to-end", () => {
  it("mounts the Floppy scene and plays a real run through to game-over", () => {
    render(<RealtimeGameRoute gameId="floppy-birds" onExit={vi.fn()} />);

    // The concrete Floppy renderer is mounted (a decorative, aria-hidden canvas).
    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute("aria-hidden", "true");

    // Ready → Start the real floppyBirds module (tickHz 60).
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // No flaps: gravity drops the bird into the ground within ~30 ticks. Pump
    // 250ms frames (the loop's per-frame cap → ≤15 ticks each) until it ends.
    let clock = 1000;
    frame(clock); // establish the loop's `last`
    for (let i = 0; i < 20 && screen.queryByRole("button", { name: /Play again/ }) === null; i++) {
      clock += 250;
      frame(clock);
    }

    // A live, playable run reached its terminal state through the shared screen.
    expect(screen.getByText("Game over")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play again/ })).toBeInTheDocument();
    expect(screen.getByText(/Final score:/)).toBeInTheDocument();
  });

  it("renders nothing for an unregistered real-time game id", () => {
    const { container } = render(<RealtimeGameRoute gameId="lumberjack" onExit={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RealtimeGameRoute — Drunk Walk end-to-end", () => {
  it("mounts the Drunk Walk scene, shows the rules explainer, and plays a real run through to game-over", () => {
    render(<RealtimeGameRoute gameId="drunk-walk" onExit={vi.fn()} />);

    // The concrete Drunk Walk renderer is mounted (a decorative, aria-hidden canvas).
    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute("aria-hidden", "true");

    // A brief rules explainer is shown before the run starts — the "tap the
    // opposite side" mechanic isn't as obvious as "tap to flap".
    expect(screen.getByText(/OPPOSITE your lean/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // No taps: gravity alone eventually tips the walker over. Pump 250ms
    // frames (the loop's per-frame cap → ≤15 ticks each) until it ends.
    let clock = 1000;
    frame(clock); // establish the loop's `last`
    for (let i = 0; i < 60 && screen.queryByRole("button", { name: /Play again/ }) === null; i++) {
      clock += 250;
      frame(clock);
    }

    // A live, playable run reached its terminal state through the shared screen.
    expect(screen.getByText("Game over")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play again/ })).toBeInTheDocument();
    expect(screen.getByText(/Final score:/)).toBeInTheDocument();
  });

  it("resolves a tap on the surface to left/right by horizontal position (tap-zone input)", () => {
    render(<RealtimeGameRoute gameId="drunk-walk" onExit={vi.fn()} />);
    const surface = screen.getByRole("application");

    // A tap on the surface's left half starts the run and is fed as this
    // tick's input — same generic pointer-down path the shared screen uses
    // for every real-time game, just resolved by position instead of a
    // single fixed primary action.
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 200,
      width: 200,
      top: 0,
      bottom: 200,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(surface, { clientX: 20 }); // left third → "left"

    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });
});
