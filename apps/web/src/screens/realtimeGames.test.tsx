import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { floppyBirds } from "@mpg/engine";
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
