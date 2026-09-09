import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

// The leaderboard's own behavior is covered in its screen/route tests; here we
// only care that the app ROUTES to it correctly, so the network is stubbed.
vi.mock("./api/leaderboard", () => ({
  submitRealtimeScore: vi.fn(async () => ({ ok: true, entry: null })),
  fetchYourRank: vi.fn(async () => ({ rank: 2, entry: null })),
  fetchLeaderboard: vi.fn(async () => ({
    entries: [
      {
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
      },
    ],
    yourRank: 1,
  })),
}));

const BOT_THINKING_STEP_MS = 600; // fallback in ./game/motion.ts (no CSS var in jsdom)

/** Advances the paced bot-thinking timer and flushes the resulting React updates. */
async function advanceBotStep(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(BOT_THINKING_STEP_MS);
  });
}

describe("App", () => {
  it("renders engine-backed content (version + registered games, both families)", () => {
    render(<App />);

    expect(screen.getByText("Engine version:")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Available games" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tic-Tac-Toe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Four" })).toBeInTheDocument();
    // MPG-040f: the real-time family shows up in the same grid.
    expect(screen.getByRole("button", { name: /Floppy Birds/ })).toBeInTheDocument();
  });

  it("MPG-040f: selecting a real-time game skips Setup and goes straight to the play surface", () => {
    // jsdom has no 2D canvas; keep the Floppy renderer's getContext quiet.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Floppy Birds/ }));

    // No seat setup at all — the quick-start preset buttons never appear.
    expect(screen.queryByRole("button", { name: /Play vs Bot/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Play a friend/ })).not.toBeInTheDocument();

    // Straight to the realtime play surface: labelled play area + the one "Start".
    expect(screen.getByRole("application", { name: /Floppy Birds play area/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();

    vi.restoreAllMocks();
  });

  it("a turn-based game quick-starts straight into play, skipping Setup", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Tic-Tac-Toe/ }));

    // Setup was skipped: no seat presets, and we're on a live board already.
    expect(screen.queryByRole("button", { name: /Play vs Bot/ })).not.toBeInTheDocument();
    expect(screen.getByRole("grid", { name: /Tic-Tac-Toe board/i })).toBeInTheDocument();
  });

  it("Options on a card opens Setup instead of quick-starting", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Options for Tic-Tac-Toe/ }));

    expect(screen.getByRole("button", { name: /Play vs Bot/ })).toBeInTheDocument();
  });

  describe("MPG-050: opponent-switch on game-over (full Home -> Setup -> Play flow)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("'Play a friend' from a finished vs-bot game starts a genuinely fresh human-vs-human game (remounts, no bot auto-move)", async () => {
      render(<App />);

      // Home -> tap Tic-Tac-Toe, which now quick-starts straight into a
      // vs-bot game (seat 1 human, seat 2 a bot) with no Setup detour.
      fireEvent.click(screen.getByRole("button", { name: /^Tic-Tac-Toe/ }));

      expect(screen.getByText("Your turn")).toBeInTheDocument();

      // Drive the game to completion: click an open cell on the human's turn,
      // then let the bot's paced move land, until Rematch appears.
      for (let i = 0; i < 9 && !screen.queryByRole("button", { name: "Rematch" }); i++) {
        const openCell = screen
          .getAllByRole("gridcell")
          .find((c) => c.getAttribute("aria-label")?.endsWith(", empty"));
        if (!openCell) break;
        fireEvent.click(openCell);
        if (screen.queryByRole("button", { name: "Rematch" })) break;
        await advanceBotStep();
      }

      expect(screen.getByRole("button", { name: "Rematch" })).toBeInTheDocument();

      // Fresh game vs a friend: two human seats, empty board, no bot "thinking".
      fireEvent.click(screen.getByRole("button", { name: /Play a friend/ }));

      expect(screen.queryByRole("button", { name: "Rematch" })).not.toBeInTheDocument();
      expect(screen.getByText("Player 1's turn")).toBeInTheDocument();
      expect(
        screen
          .getAllByRole("gridcell")
          .every((c) => c.getAttribute("aria-label")?.endsWith(", empty")),
      ).toBe(true);
      expect(screen.queryByText(/is thinking…/)).not.toBeInTheDocument();

      // Advancing timers further must not trigger any bot move — it's an
      // all-human game now, not merely relabelled seats on the old bot game.
      await advanceBotStep();
      expect(
        screen
          .getAllByRole("gridcell")
          .every((c) => c.getAttribute("aria-label")?.endsWith(", empty")),
      ).toBe(true);
    });
  });
});

describe("MPG-055: real-time run → post-game rank → full leaderboard", () => {
  let rafCb: FrameRequestCallback | null = null;

  beforeEach(() => {
    rafCb = null;
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

  it("routes a finished real-time run to that game's SCORE leaderboard", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Floppy Birds/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // Play the real module through to game over (no flaps → the bird drops).
    let clock = 1000;
    for (let i = 0; i < 25 && screen.queryByRole("button", { name: /Play again/ }) === null; i++) {
      const cb = rafCb;
      rafCb = null;
      await act(async () => {
        cb?.(clock);
      });
      clock += 250;
    }
    expect(screen.getByText("Game over")).toBeInTheDocument();

    // The post-game rank preview links onward to the full board — with the
    // real-time game's own title and the score metric, not win/loss/draw.
    fireEvent.click(await screen.findByRole("button", { name: /View full leaderboard/ }));

    expect(
      await screen.findByRole("heading", { name: /Floppy Birds Leaderboard/ }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "Best score" })).toBeInTheDocument();
  });
});
