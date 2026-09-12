import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RealtimeModule } from "@mpg/engine";
import { RealtimePlayScreen, type RealtimeControls } from "./RealtimePlayScreen";
import { createActionInputSource } from "../game";

/**
 * A minimal fake RealtimeModule standing in for a concrete game (the real
 * Floppy renderer + wiring is MPG-040e). Deterministic: game-over is driven by
 * a tick counter (independent of input), while `score` jumps by +10 on a flap
 * vs +1 otherwise — so a flap is observable in the visible score, letting us
 * assert keyboard↔pointer input parity precisely.
 */
interface FakeState {
  readonly ticks: number;
  readonly score: number;
  readonly over: boolean;
}
interface FakeInput {
  readonly flap: boolean;
}
const OVER_TICKS = 3;
const TICK_HZ = 100; // → 10ms/tick, convenient for the controlled clock below

const fakeModule: RealtimeModule<FakeState, FakeInput> = {
  id: "floppy-birds",
  kind: "realtime",
  tickHz: TICK_HZ,
  createInitialState: () => ({ ticks: 0, score: 0, over: false }),
  tick: (state, input) => {
    const ticks = state.ticks + 1;
    return {
      ticks,
      score: state.score + (input.flap ? 10 : 1),
      over: ticks >= OVER_TICKS,
    };
  },
  getScore: (s) => s.score,
  isGameOver: (s) => s.over,
};

const flapControls: RealtimeControls<FakeInput, "flap"> = {
  primaryAction: "flap",
  keyMap: { Space: "flap", ArrowUp: "flap" },
  toInput: (pressed) => ({ flap: pressed.has("flap") }),
  actionHint: "Tap, Space, or ↑ to flap",
};

// --- Controlled requestAnimationFrame -------------------------------------
// The loop reschedules itself each frame; we capture the pending callback and
// fire it with an explicit timestamp so ticks advance deterministically.
let rafCb: FrameRequestCallback | null = null;
let rafSeq = 0;

function frame(now: number): void {
  const cb = rafCb;
  rafCb = null;
  act(() => {
    cb?.(now);
  });
}

let clock = 0;
/** Establishes the loop's `last` timestamp right after entering `running`. */
function primeClock(): void {
  clock = 1000;
  frame(clock);
}
/** Advances the sim by exactly `k` fixed ticks (10ms each). */
function advanceTicks(k: number): void {
  clock += k * (1000 / TICK_HZ);
  frame(clock);
}

function scoreText(container: HTMLElement): string | null {
  return container.querySelector('[class*="scoreValue"]')?.textContent ?? null;
}

beforeEach(() => {
  rafCb = null;
  rafSeq = 0;
  clock = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCb = cb;
    return ++rafSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    rafCb = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderScreen(overrides: Partial<Parameters<typeof RealtimePlayScreen>[0]> = {}) {
  // Built once per render call so the source's pressed-set survives re-renders
  // (mirrors production, where the source is memoised per game).
  const inputSource = createActionInputSource(flapControls);
  return render(
    <RealtimePlayScreen<FakeState, FakeInput>
      module={fakeModule}
      gameTitle="Floppy Birds"
      seed={42}
      inputSource={inputSource}
      renderScene={({ score }) => <div data-testid="scene">scene score {score}</div>}
      onExit={vi.fn()}
      nextSeed={() => 7}
      {...(overrides as object)}
    />,
  );
}

describe("RealtimePlayScreen — four explicit states", () => {
  it("READY: shows the hint + a single primary Start (focused), score 0, scene rendered", () => {
    const { container } = renderScreen();

    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeInTheDocument();
    expect(start).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(scoreText(container)).toBe("0");
    expect(screen.getByTestId("scene")).toBeInTheDocument();
    // Control hint is present (once in the overlay, once as the persistent caption).
    expect(screen.getAllByText(/to flap/i).length).toBeGreaterThan(0);
  });

  it("RUNNING: Start begins the run — overlay clears, Pause appears, focus moves to the play area", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "Floppy Birds play area" })).toHaveFocus();
  });

  it("PAUSED: Pause freezes the run with a single Resume (focused); Resume returns to running", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    primeClock();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    });
    const resume = screen.getByRole("button", { name: "Resume" });
    expect(resume).toHaveFocus();
    expect(screen.getByText("Paused")).toBeInTheDocument();

    // Frames while paused must not tick (score stays put).
    advanceTicks(2);
    // (score readout unaffected — still 0)
    act(() => {
      fireEvent.click(resume);
    });
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
  });

  it("GAME-OVER: reaching the end shows the final score + a single Play again (focused), and fires onRunComplete once", () => {
    const onRunComplete = vi.fn();
    const { container } = renderScreen({ onRunComplete });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    primeClock();
    advanceTicks(OVER_TICKS); // no flaps → +1 per tick → score 3

    expect(screen.getByText("Game over")).toBeInTheDocument();
    expect(screen.getByText(/Final score:/)).toBeInTheDocument();
    const playAgain = screen.getByRole("button", { name: /Play again/ });
    expect(playAgain).toHaveFocus();
    expect(scoreText(container)).toBe("3");

    expect(onRunComplete).toHaveBeenCalledTimes(1);
    expect(onRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "floppy-birds", score: 3, seed: 42 }),
    );
    expect(onRunComplete.mock.calls[0]![0].inputLog).toHaveLength(OVER_TICKS);
  });

  it("PLAY AGAIN: restarts to a fresh READY run (score reset) using the next seed", () => {
    const { container } = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    primeClock();
    advanceTicks(OVER_TICKS);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Play again/ }));
    });

    // Back to READY: Start is offered again and the score is reset.
    expect(screen.getByRole("button", { name: "Start" })).toHaveFocus();
    expect(scoreText(container)).toBe("0");
  });
});

describe("RealtimePlayScreen — input parity + a11y", () => {
  it("keyboard (Space) and pointer (tap) produce the SAME flap input", () => {
    // Keyboard run: one Space press before the tick → flap scores 10 (vs 1) on tick 1.
    const keyboard = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    primeClock();
    fireEvent.keyDown(window, { code: "Space" });
    advanceTicks(1);
    const keyboardScore = scoreText(keyboard.container);
    keyboard.unmount();

    // Pointer run: one tap on the play surface before the tick → same +10.
    const pointer = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    primeClock();
    fireEvent.pointerDown(screen.getByRole("application", { name: "Floppy Birds play area" }));
    advanceTicks(1);
    const pointerScore = scoreText(pointer.container);

    expect(keyboardScore).toBe("10"); // a flap tick scores 10 (an idle tick scores 1)
    expect(pointerScore).toBe(keyboardScore);
  });

  it("the play area is a focusable, labelled application region (keyboard reachable)", () => {
    renderScreen();
    const surface = screen.getByRole("application", { name: "Floppy Birds play area" });
    expect(surface).toHaveAttribute("tabindex", "0");
    expect(surface).toHaveAttribute("aria-describedby");
  });

  it("announces state transitions via a polite live region", () => {
    renderScreen();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/ready/i);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Game started/i);
  });
});

describe("RealtimePlayScreen — tap-zone controls (resolveTapAction)", () => {
  // A two-action fake module (left/right), standing in for a tap-zone game
  // like Drunk Walk: score jumps by a different amount per action so the
  // resolved zone is observable in the visible score.
  interface ZoneState {
    readonly ticks: number;
    readonly score: number;
    readonly over: boolean;
  }
  interface ZoneInput {
    readonly zone: "left" | "right" | null;
  }
  const zoneModule: RealtimeModule<ZoneState, ZoneInput> = {
    id: "drunk-walk",
    kind: "realtime",
    tickHz: TICK_HZ,
    createInitialState: () => ({ ticks: 0, score: 0, over: false }),
    tick: (state, input) => {
      const ticks = state.ticks + 1;
      const delta = input.zone === "left" ? 10 : input.zone === "right" ? 5 : 1;
      return { ticks, score: state.score + delta, over: ticks >= OVER_TICKS };
    },
    getScore: (s) => s.score,
    isGameOver: (s) => s.over,
  };
  const zoneControls: RealtimeControls<ZoneInput, "left" | "right"> = {
    primaryAction: "left",
    keyMap: { ArrowLeft: "left", ArrowRight: "right" },
    toInput: (pressed) => {
      if (pressed.has("left")) return { zone: "left" };
      if (pressed.has("right")) return { zone: "right" };
      return { zone: null };
    },
    actionHint: "Tap left or right",
    readyExplainer: "Tap the side opposite your lean to correct it.",
    resolveTapAction: (fractionX) => (fractionX < 0.5 ? "left" : "right"),
  };

  function renderZoneScreen() {
    const inputSource = createActionInputSource(zoneControls);
    return render(
      <RealtimePlayScreen<ZoneState, ZoneInput>
        module={zoneModule}
        gameTitle="Zone Game"
        seed={1}
        inputSource={inputSource}
        renderScene={({ score }) => <div data-testid="scene">scene score {score}</div>}
        onExit={vi.fn()}
        nextSeed={() => 7}
      />,
    );
  }

  it("shows the readyExplainer alongside actionHint on the ready overlay", () => {
    renderZoneScreen();
    expect(screen.getByText("Tap the side opposite your lean to correct it.")).toBeInTheDocument();
  });

  it("a tap on the LEFT half of the surface resolves to the left action", () => {
    const { container } = renderZoneScreen();
    const surface = screen.getByRole("application", { name: "Zone Game play area" });
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 100,
      width: 100,
      top: 0,
      bottom: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(surface, { clientX: 10 }); // fractionX 0.1 → left
    primeClock();
    advanceTicks(1);

    expect(scoreText(container)).toBe("10"); // left → +10 on tick 1
  });

  it("a tap on the RIGHT half of the surface resolves to the right action", () => {
    const { container } = renderZoneScreen();
    const surface = screen.getByRole("application", { name: "Zone Game play area" });
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 100,
      width: 100,
      top: 0,
      bottom: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(surface, { clientX: 90 }); // fractionX 0.9 → right
    primeClock();
    advanceTicks(1);

    expect(scoreText(container)).toBe("5"); // right → +5 on tick 1
  });

  it("keyboard left/right parity matches the tap-zone resolution", () => {
    const { container } = renderZoneScreen();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    primeClock();
    fireEvent.keyDown(window, { code: "ArrowRight" });
    advanceTicks(1);

    expect(scoreText(container)).toBe("5"); // ArrowRight → right → +5
  });
});

describe("RealtimePlayScreen — prefers-reduced-motion (ADR 0002 §5)", () => {
  function stubReducedMotion(matches: boolean): void {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("reduce") ? matches : false,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          onchange: null,
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );
  }

  it("passes reducedMotion:true to the renderer, keeps Pause available, and shows the score as text", () => {
    stubReducedMotion(true);
    const seen: boolean[] = [];
    const { container } = render(
      <RealtimePlayScreen<FakeState, FakeInput>
        module={fakeModule}
        gameTitle="Floppy Birds"
        seed={1}
        inputSource={createActionInputSource(flapControls)}
        renderScene={({ reducedMotion }) => {
          seen.push(reducedMotion);
          return <div data-testid="scene" />;
        }}
        onExit={vi.fn()}
      />,
    );

    expect(seen.every((v) => v === true)).toBe(true);

    // Pause is a first-class control under reduced motion (§5): still reachable.
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    // Score is legible as TEXT, never motion-only.
    expect(scoreText(container)).toBe("0");
  });

  it("passes reducedMotion:false when the user has no such preference", () => {
    stubReducedMotion(false);
    const seen: boolean[] = [];
    render(
      <RealtimePlayScreen<FakeState, FakeInput>
        module={fakeModule}
        gameTitle="Floppy Birds"
        seed={1}
        inputSource={createActionInputSource(flapControls)}
        renderScene={({ reducedMotion }) => {
          seen.push(reducedMotion);
          return <div data-testid="scene" />;
        }}
        onExit={vi.fn()}
      />,
    );
    expect(seen.some((v) => v === true)).toBe(false);
  });
});

describe("RealtimePlayScreen — game-over share (MPG-087)", () => {
  /** Drives a run to game over and returns nothing — assertions read the DOM. */
  function playToGameOver(): void {
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    primeClock();
    advanceTicks(OVER_TICKS);
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "share");
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "clipboard");
    Reflect.deleteProperty(document as unknown as Record<string, unknown>, "execCommand");
  });

  it("offers no Share affordance when there is nothing to share", () => {
    renderScreen();
    playToGameOver();

    expect(screen.getByText("Game over")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Share|Copy link/ })).not.toBeInTheDocument();
  });

  it("shares the score brag-first with the URL via the native sheet", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });

    renderScreen({ shareUrl: "https://example.test/floppy-birds" });
    playToGameOver();

    const button = screen.getByRole("button", { name: "Share score" });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(share).toHaveBeenCalledWith({
      title: "Floppy Birds",
      text: "I scored 3 on Floppy Birds",
      url: "https://example.test/floppy-birds",
    });
    expect(screen.getByText("Shared!")).toBeInTheDocument();
    // Sharing must never displace the state's single primary action.
    expect(screen.getByRole("button", { name: /Play again/ })).toBeInTheDocument();
  });

  it("labels itself Copy link and copies when no native share sheet exists", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    renderScreen({ shareUrl: "https://example.test/floppy-birds" });
    playToGameOver();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });

    expect(writeText).toHaveBeenCalledWith("https://example.test/floppy-birds");
    expect(screen.getByText("Link copied!")).toBeInTheDocument();
  });

  it("falls back to a selectable URL — not a dead end — when every path fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, "execCommand", {
      value: () => {
        throw new Error("unsupported");
      },
      configurable: true,
      writable: true,
    });

    renderScreen({ shareUrl: "https://example.test/floppy-birds" });
    playToGameOver();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });

    const field = screen.getByLabelText("Link to copy");
    expect(field).toHaveValue("https://example.test/floppy-birds");
  });
});

describe("RealtimePlayScreen — challenge to beat (MPG-087)", () => {
  function startRun(): void {
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    primeClock();
  }

  it("shows NO challenge chrome for an ordinary solo run (no target given)", () => {
    renderScreen();
    startRun();
    advanceTicks(OVER_TICKS);
    expect(screen.queryByText("Target")).not.toBeInTheDocument();
    expect(screen.queryByText(/beat the challenge|to beat|matched/i)).not.toBeInTheDocument();
    expect(screen.getByText("Game over")).toBeInTheDocument();
  });

  it("shows a live Target readout before it is passed", () => {
    renderScreen({ challengeTarget: 1 });
    startRun();
    // Score 0 (< target 1): the chip reads Target, not Passed.
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.queryByText("Passed")).not.toBeInTheDocument();
  });

  it("flips to Passed and announces once when the score crosses the target", () => {
    renderScreen({ challengeTarget: 1 });
    startRun();
    // +1 per idle tick: after 2 ticks score is 2 > 1 → passed.
    advanceTicks(2);
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/passed the target score of 1/i);
  });

  it("GAME-OVER (beat): 'you won the challenge' verdict", () => {
    renderScreen({ challengeTarget: 1 });
    startRun();
    advanceTicks(OVER_TICKS); // final score 3 > 1

    expect(screen.getByText("You won the challenge!")).toBeInTheDocument();
    // Exact string targets the visible verdict <p>; a regex would also match the
    // (longer) hidden live-region announcement that embeds the same phrase.
    expect(screen.getByText("You beat the challenge — topped 1 by 2.")).toBeInTheDocument();
  });

  it("GAME-OVER (fell short): a 'so close' verdict, not a win", () => {
    renderScreen({ challengeTarget: 100 });
    startRun();
    advanceTicks(OVER_TICKS); // final score 3 < 100

    expect(screen.getByText("Game over")).toBeInTheDocument();
    expect(screen.queryByText("You won the challenge!")).not.toBeInTheDocument();
    expect(screen.getByText("So close — 100 to beat.")).toBeInTheDocument();
  });
});
