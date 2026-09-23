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

// CHAT-004: routing tests only care that App reaches ChatScreen with the
// right roomId — the hook's own behavior (Ably wiring, degrade-to-absence,
// …) is covered by useChatChannel's own tests. Stubbed here so a routing
// test never opens a real Ably connection.
vi.mock("./hooks/useChatChannel.js", () => ({
  useChatChannel: () => ({
    status: "unavailable" as const,
    messages: [],
    send: vi.fn(),
    connectionState: "unknown" as const,
  }),
}));

const BOT_THINKING_STEP_MS = 600; // fallback in ./game/motion.ts (no CSS var in jsdom)

/** Advances the paced bot-thinking timer and flushes the resulting React updates. */
async function advanceBotStep(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(BOT_THINKING_STEP_MS);
  });
}

describe("App", () => {
  it("renders engine-backed content (registered games, both families)", () => {
    render(<App />);

    // The engine build stamp is developer chrome and now sits behind `?dev`
    // (UI-4) — what Home owes a player is the games themselves.
    expect(screen.queryByText("Engine version:")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Featured games" })).toBeInTheDocument();
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

describe("MPG-056: a durable share link is its own entry point", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/s/tok-shared");
  });

  afterEach(() => {
    window.history.pushState({}, "", "/");
    vi.unstubAllGlobals();
  });

  it("opens /s/:token straight into the shared view — no session, no Home fallthrough", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          kind: "result",
          result: {
            gameId: "floppy-birds",
            gameFamily: "realtime",
            status: "complete",
            score: 42,
            winnerSlot: null,
            seatsSnapshot: null,
            durationMs: null,
            createdAt: "2026-09-09T00:00:00.000Z",
          },
        }),
      }),
    );

    render(<App />);

    // The visitor lands on the result, not on the game grid.
    expect(await screen.findByText("Scored 42")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Featured games" })).not.toBeInTheDocument();
  });

  it("a dead link still lands somewhere with a way into a game", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    render(<App />);

    expect(await screen.findByText("Link no longer works")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browse games" }));
    expect(screen.getByRole("list", { name: "Featured games" })).toBeInTheDocument();
  });

  // MPG-087: a scored shared result is a challenge. "Beat this score" drops the
  // visitor into that game with the sharer's score set as the live Target.
  it("'Beat this score' opens the game with the shared score as the Target", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          kind: "result",
          result: {
            gameId: "floppy-birds",
            gameFamily: "realtime",
            status: "complete",
            score: 42,
            winnerSlot: null,
            seatsSnapshot: null,
            durationMs: null,
            createdAt: "2026-09-09T00:00:00.000Z",
          },
        }),
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Beat this score" }));

    // Landed in the game (not Home), with the challenge target shown.
    expect(screen.getByRole("application", { name: /Floppy Birds play area/ })).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Featured games" })).not.toBeInTheDocument();
  });
});

// MPG-087: the share fallback (`buildShareUrl`) points at a bare `/:gameId`
// whenever no durable `/s/:token` could be minted (offline / backend down).
// That link must OPEN the game — landing on Home would be the 404-equivalent
// bug this closes — and it must do so with no session and no network.
describe("MPG-087: a bare /:gameId deep link opens the game (share fallback)", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("opens a real-time game straight onto its play surface, not Home", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    window.history.pushState({}, "", "/floppy-birds");

    render(<App />);

    expect(screen.getByRole("application", { name: /Floppy Birds play area/ })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Featured games" })).not.toBeInTheDocument();
  });

  it("opens a turn-based game onto a live board, not Home", () => {
    window.history.pushState({}, "", "/tictactoe");

    render(<App />);

    expect(screen.getByRole("grid", { name: /Tic-Tac-Toe board/i })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Featured games" })).not.toBeInTheDocument();
  });

  // The backend-free counterpart to "Beat this score": when the durable link
  // couldn't be minted, the score rides in the URL as `?challenge=<n>`, and this
  // link must reproduce the same challenge — the game open AND the Target set.
  it("a `?challenge=<score>` rider opens the game with that score as the Target", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    window.history.pushState({}, "", "/floppy-birds?challenge=42");

    render(<App />);

    expect(screen.getByRole("application", { name: /Floppy Birds play area/ })).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Featured games" })).not.toBeInTheDocument();
  });

  it("a malformed challenge rider is ignored — the game opens without a Target", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    window.history.pushState({}, "", "/floppy-birds?challenge=not-a-number");

    render(<App />);

    expect(screen.getByRole("application", { name: /Floppy Birds play area/ })).toBeInTheDocument();
    expect(screen.queryByText("Target")).not.toBeInTheDocument();
  });

  it("an unknown single-segment path still falls through to Home", () => {
    window.history.pushState({}, "", "/not-a-game");

    render(<App />);

    expect(screen.getByRole("list", { name: "Featured games" })).toBeInTheDocument();
  });
});

// CHAT-004: the standalone chat route.
describe("CHAT-004: chat routing", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("opens `/chat` onto the chat screen, defaulting to the Global room", () => {
    window.history.pushState({}, "", "/chat");

    render(<App />);

    // The header names the room you are in — a bare `/chat` is Global
    // (CHAT-022), the same room the rail marks as current.
    expect(screen.getByRole("heading", { name: /Global/ })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Featured games" })).not.toBeInTheDocument();
  });

  it("opens `/chat/:roomId` onto the chat screen for that room", () => {
    window.history.pushState({}, "", "/chat/my-room");

    render(<App />);

    expect(screen.getByRole("heading", { name: /my-room/ })).toBeInTheDocument();
  });

  it("Home offers a labelled entry point into chat that navigates and updates the URL", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(screen.getByRole("heading", { name: /Global/ })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/chat");
  });

  it("Home is reachable from chat via the labelled Home control", () => {
    window.history.pushState({}, "", "/chat");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    expect(screen.getByRole("list", { name: "Featured games" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("back/forward navigation (popstate) re-parses a chat URL", () => {
    render(<App />);
    expect(screen.getByRole("list", { name: "Featured games" })).toBeInTheDocument();

    act(() => {
      window.history.pushState({}, "", "/chat");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.getByRole("heading", { name: /Global/ })).toBeInTheDocument();
  });
});
