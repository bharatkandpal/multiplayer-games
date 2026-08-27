import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RealtimeModule } from "@mpg/engine";
import { useRealtimeLoop, type RunComplete } from "./useRealtimeLoop";

// A deterministic fake module: state is a tick counter, one increment per tick,
// game-over at `endAt`. Score == count. Input is ignored by the sim but still
// sampled + logged each tick, so we can assert the input-log records every tick.
interface CounterState {
  readonly count: number;
}
function makeCounter(endAt: number): RealtimeModule<CounterState, number> {
  return {
    id: "floppy-birds",
    kind: "realtime",
    tickHz: 60,
    createInitialState: () => ({ count: 0 }),
    tick: (s) => ({ count: s.count + 1 }),
    getScore: (s) => s.count,
    isGameOver: (s) => s.count >= endAt,
  };
}

/** Advances the faked clock (and thus the faked rAF loop) inside `act`. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useRealtimeLoop", () => {
  beforeEach(() => {
    // Fake the rAF loop so the fixed-step sim advances deterministically under test.
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "Date"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(endAt: number, onRunComplete?: (r: RunComplete<number>) => void) {
    let nextInput = 0;
    const sampleInput = (): number => nextInput++;
    const module = makeCounter(endAt);
    const view = renderHook(() =>
      useRealtimeLoop({ module, seed: 123, sampleInput, ...(onRunComplete ? { onRunComplete } : {}) }),
    );
    return view;
  }

  it("starts in the 'ready' phase and does not tick until started", async () => {
    const { result } = setup(5);
    expect(result.current.phase).toBe("ready");
    expect(result.current.tickCount).toBe(0);

    await advance(1000); // frames fire, but a 'ready' loop consumes no ticks
    expect(result.current.tickCount).toBe(0);
    expect(result.current.phase).toBe("ready");
  });

  it("drives a module deterministically to game-over once started", async () => {
    const { result } = setup(5);
    act(() => result.current.start());
    expect(result.current.phase).toBe("running");

    await advance(1000);
    expect(result.current.phase).toBe("over");
    expect(result.current.score).toBe(5);
  });

  it("fires onRunComplete exactly once, with the seed and the full input log", async () => {
    const onRunComplete = vi.fn();
    const { result } = setup(5, onRunComplete);
    act(() => result.current.start());

    await advance(1000);
    expect(onRunComplete).toHaveBeenCalledTimes(1);

    const payload = onRunComplete.mock.calls[0]![0] as RunComplete<number>;
    expect(payload.gameId).toBe("floppy-birds");
    expect(payload.seed).toBe(123);
    expect(payload.score).toBe(5);
    // Input-log length == ticks consumed (exactly 5 to reach game-over), and it
    // recorded every sampled input in order.
    expect(payload.inputLog).toEqual([0, 1, 2, 3, 4]);
    expect(payload.inputLog.length).toBe(result.current.tickCount);

    // Ticking further must not fire it again — game-over is terminal.
    await advance(1000);
    expect(onRunComplete).toHaveBeenCalledTimes(1);
  });

  it("pause halts ticks; resume continues from where it left off", async () => {
    const { result } = setup(10_000); // long run so it never ends during the test
    act(() => result.current.start());

    await advance(200);
    const paused_at = result.current.tickCount;
    expect(paused_at).toBeGreaterThan(0);

    act(() => result.current.pause());
    expect(result.current.phase).toBe("paused");

    await advance(2000); // no ticks while paused
    expect(result.current.tickCount).toBe(paused_at);

    act(() => result.current.resume());
    expect(result.current.phase).toBe("running");
    await advance(200);
    expect(result.current.tickCount).toBeGreaterThan(paused_at);
  });

  it("auto-pauses when the window blurs (backgrounded tab)", async () => {
    const { result } = setup(10_000);
    act(() => result.current.start());
    await advance(200);
    const at_blur = result.current.tickCount;

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current.phase).toBe("paused");

    await advance(2000);
    expect(result.current.tickCount).toBe(at_blur); // frozen while backgrounded
  });

  it("restart resets to a fresh 'ready' run", async () => {
    const { result } = setup(5);
    act(() => result.current.start());
    await advance(1000);
    expect(result.current.phase).toBe("over");

    act(() => result.current.restart());
    expect(result.current.phase).toBe("ready");
    expect(result.current.tickCount).toBe(0);
    expect(result.current.score).toBe(0);

    act(() => result.current.start());
    await advance(1000);
    expect(result.current.phase).toBe("over");
    expect(result.current.score).toBe(5);
  });
});
