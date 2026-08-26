import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

const BOT_THINKING_STEP_MS = 600; // fallback in ./game/motion.ts (no CSS var in jsdom)

/** Advances the paced bot-thinking timer and flushes the resulting React updates. */
async function advanceBotStep(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(BOT_THINKING_STEP_MS);
  });
}

describe("App", () => {
  it("renders engine-backed content (version + registered games)", () => {
    render(<App />);

    expect(screen.getByText("Engine version:")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Available games" })).toBeInTheDocument();
    expect(screen.getByText("tictactoe")).toBeInTheDocument();
    expect(screen.getByText("connect4")).toBeInTheDocument();
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

      // Home -> pick Tic-Tac-Toe -> Setup -> "Play vs Bot" quick-start (seat 1
      // human, seat 2 a medium bot).
      fireEvent.click(screen.getByRole("button", { name: /^Tic-Tac-Toe/ }));
      fireEvent.click(screen.getByRole("button", { name: /Play vs Bot/ }));

      expect(screen.getByText("You's turn")).toBeInTheDocument();

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
