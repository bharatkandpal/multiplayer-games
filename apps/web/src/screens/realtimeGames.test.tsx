import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  aimTrainer,
  drunkWalk,
  floppyBirds,
  lumberjack,
  memorySequence,
  snake,
  type RealtimeGameId,
} from "@mpg/engine";
import { REALTIME_GAMES, RealtimeGameRoute } from "./realtimeGames";
import { fetchYourRank, submitRealtimeScore, type LeaderboardEntry } from "../api/leaderboard";
import { mintResultShareUrl, shareUrlForToken } from "../api/share";

const RANKED_ENTRY: LeaderboardEntry = {
  id: "e1",
  gameId: "floppy-birds",
  metric: "score",
  eventId: null,
  timeBucket: null,
  ownerToken: "tok-abcdef",
  wins: 0,
  losses: 0,
  draws: 0,
  bestScore: 7,
  totalGames: 1,
  runId: "r1",
  updatedAt: "2026-09-09T00:00:00.000Z",
};

// The leaderboard is a server concern; these tests assert the CLIENT's
// sequencing (submit the run, then read the rank the write produced).
// Mocked at `mintResultShareUrl` rather than at `createShareLink` beneath it:
// that helper is the seam the route actually calls (MPG-131 moved it into
// `api/share` so both game families mint through one path), and a mock on the
// inner function would not intercept a same-module call anyway.
vi.mock("../api/share", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/share")>();
  return { ...actual, mintResultShareUrl: vi.fn() };
});

vi.mock("../api/leaderboard", () => ({
  submitRealtimeScore: vi.fn(async () => ({ ok: true, entry: null })),
  fetchYourRank: vi.fn(),
}));

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
  vi.mocked(submitRealtimeScore).mockReset().mockResolvedValue({ ok: true, entry: null });
  vi.mocked(fetchYourRank).mockReset().mockResolvedValue({ rank: 4, entry: RANKED_ENTRY });
  vi.mocked(mintResultShareUrl).mockReset().mockResolvedValue(shareUrlForToken("tok-durable"));
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
    expect(wiring!.controls!.primaryAction).toBe("flap");
    // Action games build the discrete-action source.
    expect(wiring!.makeInputSource().id).toBe("actions");
  });

  it("resolves 'drunk-walk' to the real engine module + a renderer + tap-zone controls", () => {
    const wiring = REALTIME_GAMES["drunk-walk"];
    expect(wiring).toBeDefined();
    expect(wiring!.module).toBe(drunkWalk);
    expect(wiring!.module.id).toBe("drunk-walk");
    expect(typeof wiring!.renderScene).toBe("function");
    // Left/right tap-zone resolution, not a single fixed primary action.
    expect(typeof wiring!.controls!.resolveTapAction).toBe("function");
    const resolve = wiring!.controls!.resolveTapAction!;
    // A left/right game ignores the vertical fraction — any Y resolves the same.
    expect(resolve(0.1, 0.5)).toBe("left");
    expect(resolve(0.9, 0.5)).toBe("right");
    // Keyboard parity: arrows AND A/D map to the same left/right actions.
    expect(wiring!.controls!.keyMap.ArrowLeft).toBe("left");
    expect(wiring!.controls!.keyMap.KeyA).toBe("left");
    expect(wiring!.controls!.keyMap.ArrowRight).toBe("right");
    expect(wiring!.controls!.keyMap.KeyD).toBe("right");
    // A rules explainer is offered — the mechanic isn't a trivial "tap to act".
    expect(wiring!.controls!.readyExplainer).toBeTruthy();
  });

  it("resolves 'breakout' to a pointer-axis (position-controlled) source", () => {
    const wiring = REALTIME_GAMES["breakout"];
    expect(wiring).toBeDefined();
    expect(wiring!.module.id).toBe("breakout");
    // Position control, not discrete actions — the paddle tracks the pointer.
    expect(wiring!.controls).toBeUndefined();
    expect(wiring!.makeInputSource().id).toBe("pointer-axis");
  });

  it("resolves 'memory-sequence' to the real engine module + four quadrant tap-zones", () => {
    const wiring = REALTIME_GAMES["memory-sequence"];
    expect(wiring).toBeDefined();
    expect(wiring!.module).toBe(memorySequence);
    expect(wiring!.makeInputSource().id).toBe("actions");

    // No on-screen buttons: the board itself is the control. A tap resolves by
    // the quadrant it lands in, matching the scene's 2×2 layout — pad0 top-left,
    // pad1 top-right, pad2 bottom-left, pad3 bottom-right.
    expect(wiring!.controls!.touchActions).toBeUndefined();
    const resolve = wiring!.controls!.resolveTapAction!;
    expect(resolve(0.25, 0.25)).toBe("pad0");
    expect(resolve(0.75, 0.25)).toBe("pad1");
    expect(resolve(0.25, 0.75)).toBe("pad2");
    expect(resolve(0.75, 0.75)).toBe("pad3");
    // Number-row parity, because "which arrow is the bottom-right pad?" has no
    // good answer and "which key is pad 3?" has an obvious one.
    expect(wiring!.controls!.keyMap.Digit1).toBe("pad0");
    expect(wiring!.controls!.keyMap.Digit4).toBe("pad3");
  });

  it("resolves 'aim-trainer' to the real engine module + the tap-target source", () => {
    const wiring = REALTIME_GAMES["aim-trainer"];
    expect(wiring).toBeDefined();
    expect(wiring!.module).toBe(aimTrainer);
    // Position control, not discrete actions — where you tap IS the input.
    expect(wiring!.controls).toBeUndefined();
    expect(wiring!.makeInputSource().id).toBe("tap-target");
  });

  it("resolves 'lumberjack' to the real engine module + left/right tap-zone chopping", () => {
    const wiring = REALTIME_GAMES["lumberjack"];
    expect(wiring).toBeDefined();
    expect(wiring!.module).toBe(lumberjack);
    expect(wiring!.module.id).toBe("lumberjack");
    expect(typeof wiring!.renderScene).toBe("function");
    expect(wiring!.makeInputSource().id).toBe("actions");

    // The two halves of the surface are the two choices, like Drunk Walk.
    const resolve = wiring!.controls!.resolveTapAction!;
    expect(resolve(0.1, 0.5)).toBe("left");
    expect(resolve(0.9, 0.5)).toBe("right");
    expect(wiring!.controls!.keyMap.ArrowLeft).toBe("left");
    expect(wiring!.controls!.keyMap.KeyD).toBe("right");
    // The timer is a way to lose, so it is named before the run, not after it.
    expect(wiring!.controls!.readyExplainer).toMatch(/timer/i);
  });

  it("resolves 'snake' to the real engine module + four-direction steering", () => {
    const wiring = REALTIME_GAMES["snake"];
    expect(wiring).toBeDefined();
    expect(wiring!.module).toBe(snake);
    expect(wiring!.module.id).toBe("snake");
    expect(typeof wiring!.renderScene).toBe("function");
    expect(wiring!.makeInputSource().id).toBe("actions");

    // Three ways in to the same four actions: a real swipe, on-screen buttons,
    // and keyboard parity on both arrows and WASD.
    const resolveSwipe = wiring!.controls!.resolveSwipeAction!;
    expect(resolveSwipe(40, 5)).toBe("right");
    expect(resolveSwipe(-40, 5)).toBe("left");
    expect(resolveSwipe(5, 40)).toBe("down");
    expect(resolveSwipe(5, -40)).toBe("up");
    expect(wiring!.controls!.touchActions?.map((a) => a.action).sort()).toEqual([
      "down",
      "left",
      "right",
      "up",
    ]);
    expect(wiring!.controls!.keyMap.ArrowUp).toBe("up");
    expect(wiring!.controls!.keyMap.KeyW).toBe("up");
    expect(wiring!.controls!.keyMap.KeyD).toBe("right");
    // The reversal rule is a losing surprise if nobody says it — so it's in the
    // explainer the player sees BEFORE starting, not just in the rules sheet.
    expect(wiring!.controls!.readyExplainer).toMatch(/turn back on yourself/i);
  });
});

describe("RealtimeGameRoute — Aim Trainer end-to-end", () => {
  it("mounts the scene and runs out of misses when nobody shoots", () => {
    render(<RealtimeGameRoute gameId="aim-trainer" onExit={vi.fn()} />);

    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // Letting targets expire is a miss; five of them ends the run.
    let clock = 1000;
    frame(clock);
    for (let i = 0; i < 60 && screen.queryByRole("button", { name: /Play again/ }) === null; i++) {
      clock += 250;
      frame(clock);
    }

    expect(screen.getByText("Game over")).toBeInTheDocument();
    expect(screen.getByText(/Final score:/)).toBeInTheDocument();
  });
});

describe("RealtimeGameRoute — Memory Sequence end-to-end", () => {
  it("mounts the scene and ends the run when the turn times out", () => {
    render(<RealtimeGameRoute gameId="memory-sequence" onExit={vi.fn()} />);

    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    let clock = 1000;
    frame(clock);
    for (let i = 0; i < 80 && screen.queryByRole("button", { name: /Play again/ }) === null; i++) {
      clock += 250;
      frame(clock);
    }

    expect(screen.getByText("Game over")).toBeInTheDocument();
  });
});

describe("RealtimeGameRoute — Lumberjack end-to-end", () => {
  it("mounts the Lumberjack scene and loses to the timer when nobody chops", () => {
    render(<RealtimeGameRoute gameId="lumberjack" onExit={vi.fn()} />);

    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // The clock is the point: idle long enough and the run ends on its own.
    let clock = 1000;
    frame(clock);
    for (let i = 0; i < 40 && screen.queryByRole("button", { name: /Play again/ }) === null; i++) {
      clock += 250;
      frame(clock);
    }

    expect(screen.getByText("Game over")).toBeInTheDocument();
    expect(screen.getByText(/Final score:/)).toBeInTheDocument();
  });
});

describe("RealtimeGameRoute — Snake end-to-end", () => {
  it("mounts the Snake scene and plays a real run through to game-over", () => {
    render(<RealtimeGameRoute gameId="snake" onExit={vi.fn()} />);

    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // No steering: the snake runs straight into the right wall in a handful of
    // steps. Pump 250ms frames until the run reaches its terminal state.
    let clock = 1000;
    frame(clock);
    for (let i = 0; i < 20 && screen.queryByRole("button", { name: /Play again/ }) === null; i++) {
      clock += 250;
      frame(clock);
    }

    expect(screen.getByText("Game over")).toBeInTheDocument();
    expect(screen.getByText(/Final score:/)).toBeInTheDocument();
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
    // Every member of `RealtimeGameId` is now wired (MPG-041 spent the last
    // reserved id, `lumberjack`), so this case has to be provoked with a cast.
    // It is still worth asserting: the union is the COMPILE-time contract, and
    // this is the runtime behaviour for an id that reaches the route without a
    // wiring row — degrade to absence, never to a crash.
    const unregistered = "not-a-game" as RealtimeGameId;
    const { container } = render(<RealtimeGameRoute gameId={unregistered} onExit={vi.fn()} />);
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

describe("RealtimeGameRoute — 2048 board size (MPG-096)", () => {
  afterEach(() => window.localStorage.clear());

  it("opens the size menu from the cog and persists a new size", () => {
    render(<RealtimeGameRoute gameId="2048" onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Change board size" }));
    // 4×4 is the default selection until the player changes it.
    expect(screen.getByRole("button", { name: /4 by 4/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /3 by 3/ }));
    expect(window.localStorage.getItem("mpg:2048:size")).toBe("3");

    // Picking a size is a complete choice — the sheet closes so the fresh run
    // is visible immediately, rather than leaving the picker over the board.
    expect(screen.queryByRole("dialog", { name: "Board size" })).not.toBeInTheDocument();
  });

  it("starts on the player's stored non-default size", () => {
    window.localStorage.setItem("mpg:2048:size", "5");
    render(<RealtimeGameRoute gameId="2048" onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Change board size" }));
    expect(screen.getByRole("button", { name: /5 by 5/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("RealtimeGameRoute — post-game leaderboard rank (MPG-055)", () => {
  /** Plays a real Floppy Birds run through to game over. */
  function playToGameOver(): void {
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    let clock = 1000;
    frame(clock);
    for (let i = 0; i < 20 && screen.queryByRole("button", { name: /Play again/ }) === null; i++) {
      clock += 250;
      frame(clock);
    }
    expect(screen.getByText("Game over")).toBeInTheDocument();
  }

  it("submits the run, then shows the rank preview read AFTER the write settled", async () => {
    const onViewLeaderboard = vi.fn();
    render(
      <RealtimeGameRoute
        gameId="floppy-birds"
        onExit={vi.fn()}
        onViewLeaderboard={onViewLeaderboard}
      />,
    );
    playToGameOver();

    // The run is submitted for server-side re-simulation with the seed + the
    // full input log — the client's score is never the authority.
    expect(submitRealtimeScore).toHaveBeenCalledTimes(1);
    const [gameId, submission] = vi.mocked(submitRealtimeScore).mock.calls[0]!;
    expect(gameId).toBe("floppy-birds");
    expect(submission.runId).toBeTruthy();
    expect(submission.inputLog.length).toBeGreaterThan(0);

    // Rank is fetched only once the submission settled, and on the "score"
    // metric — real-time games don't rank on win/loss/draw.
    expect(await screen.findByText("#4")).toBeInTheDocument();
    expect(fetchYourRank).toHaveBeenCalledWith("floppy-birds", { metric: "score" });

    fireEvent.click(screen.getByRole("button", { name: /View full leaderboard/ }));
    expect(onViewLeaderboard).toHaveBeenCalledTimes(1);
  });

  it("does not fetch a rank before the score submission settles", async () => {
    let settle: (() => void) | undefined;
    vi.mocked(submitRealtimeScore).mockReturnValueOnce(
      new Promise((resolve) => {
        settle = () => resolve({ ok: true, entry: null });
      }),
    );

    render(
      <RealtimeGameRoute gameId="floppy-birds" onExit={vi.fn()} onViewLeaderboard={vi.fn()} />,
    );
    playToGameOver();

    // Submission in flight: no rank shown, and nothing read from the server yet
    // (reading now would report the PREVIOUS run's rank under this run's score).
    expect(fetchYourRank).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /View full leaderboard/ })).not.toBeInTheDocument();

    await act(async () => {
      settle!();
    });
    expect(await screen.findByText("#4")).toBeInTheDocument();
  });

  it("omits the rank preview entirely when there is nowhere to view the leaderboard", async () => {
    render(<RealtimeGameRoute gameId="floppy-birds" onExit={vi.fn()} />);
    playToGameOver();

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchYourRank).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /View full leaderboard/ })).not.toBeInTheDocument();
  });
});

describe("RealtimeGameRoute — durable share link (MPG-056)", () => {
  // A stubbed native share sheet, so the URL actually handed to the platform is
  // observable rather than inferred.
  let shareSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: shareSpy, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "share");
  });

  function playToGameOver(): void {
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    let clock = 1000;
    frame(clock);
    for (let i = 0; i < 20 && screen.queryByRole("button", { name: /Play again/ }) === null; i++) {
      clock += 250;
      frame(clock);
    }
  }

  it("mints a link to the persisted RESULT and shares that, not the game URL", async () => {
    vi.mocked(submitRealtimeScore).mockResolvedValue({
      ok: true,
      entry: null,
      resultId: "res-42",
    });
    render(<RealtimeGameRoute gameId="floppy-birds" onExit={vi.fn()} />);
    playToGameOver();

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The link points at the result row the server just persisted — the client
    // only knows its own runId, so this id has to come back from the submit.
    expect(mintResultShareUrl).toHaveBeenCalledWith("res-42");

    // ...and the share affordance hands over exactly that URL.
    fireEvent.click(screen.getByRole("button", { name: /Share score|Copy link/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect((shareSpy.mock.calls[0]![0] as { url: string }).url).toContain("/s/tok-durable");
  });

  it("falls back to the game URL when the link can't be minted — sharing never breaks", async () => {
    vi.mocked(submitRealtimeScore).mockResolvedValue({
      ok: true,
      entry: null,
      resultId: "res-42",
    });
    // `mintResultShareUrl` never rejects — it resolves `undefined` when the
    // link can't be minted, which is exactly the offline/service-down case.
    vi.mocked(mintResultShareUrl).mockResolvedValue(undefined);

    render(<RealtimeGameRoute gameId="floppy-birds" onExit={vi.fn()} />);
    playToGameOver();

    await act(async () => {
      await Promise.resolve();
    });

    // The affordance is still there and still offers a real URL.
    expect(screen.getByRole("button", { name: /Share score|Copy link/ })).toBeInTheDocument();
  });

  it("does not mint a link when the score submission never produced a result", async () => {
    vi.mocked(submitRealtimeScore).mockResolvedValue({ ok: true, entry: null });

    render(<RealtimeGameRoute gameId="floppy-birds" onExit={vi.fn()} />);
    playToGameOver();

    await act(async () => {
      await Promise.resolve();
    });
    expect(mintResultShareUrl).not.toHaveBeenCalled();
  });
});
