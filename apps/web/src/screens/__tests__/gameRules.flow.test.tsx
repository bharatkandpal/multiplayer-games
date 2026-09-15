import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TicTacToeRoute } from "../games";
import { RealtimeGameRoute } from "../realtimeGames";
import { rulesSeenStorageKey } from "../../hooks/useGameRules";
import type { SeatsConfig } from "../../game";

/**
 * MPG-138: the two ways a player meets the rules — unasked the first time they
 * open a game, and on demand from the top-bar Rules control ever after.
 *
 * Driven through a real route rather than `GamePlayScreenView` directly, so
 * this covers the wiring (game id → rules lookup → control → sheet) and not
 * just the sheet in isolation.
 */

const SEATS: SeatsConfig = [{ kind: "human" }, { kind: "human" }];

/** Forgets that this device has seen Tic-Tac-Toe's rules — a brand-new player. */
function forgetRules(): void {
  window.localStorage.removeItem(rulesSeenStorageKey("tictactoe"));
}

describe("in-game rules (MPG-138)", () => {
  beforeEach(() => {
    forgetRules();
  });

  it("opens the rules by itself the first time a player opens a game", () => {
    render(<TicTacToeRoute seats={SEATS} onExit={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "How to play Tic-Tac-Toe" })).toBeInTheDocument();
    expect(screen.getByText(/three of your marks in a row/i)).toBeInTheDocument();
  });

  it("does not open again once the player has seen it", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TicTacToeRoute seats={SEATS} onExit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Got it" }));
    unmount();

    render(<TicTacToeRoute seats={SEATS} onExit={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves the board playable — dismissing returns the player to their game", async () => {
    const user = userEvent.setup();
    render(<TicTacToeRoute seats={SEATS} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));
    expect(screen.getByText("Player 2's turn")).toBeInTheDocument();
  });

  it("stays reachable mid-game from the Rules control", async () => {
    const user = userEvent.setup();
    render(<TicTacToeRoute seats={SEATS} onExit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Got it" }));

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));

    await user.click(screen.getByRole("button", { name: "Rules" }));
    expect(screen.getByRole("dialog", { name: "How to play Tic-Tac-Toe" })).toBeInTheDocument();

    // Closing puts the player back on the same board — a rules lookup is never
    // a restart.
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1, X" })).toBeInTheDocument();
    expect(screen.getByText("Player 2's turn")).toBeInTheDocument();
  });

  it("opens over an arcade game's ready state without stranding focus behind it", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem(rulesSeenStorageKey("reflex-test"));
    render(<RealtimeGameRoute gameId="reflex-test" onExit={vi.fn()} />);

    const sheet = screen.getByRole("dialog", { name: "How to play Reflex Test" });
    expect(sheet).toBeInTheDocument();
    // The ready state focuses Start on mount. While the sheet is up, focus must
    // stay inside it — otherwise the player is tabbing through a control hidden
    // behind the dialog.
    expect(sheet.contains(document.activeElement)).toBe(true);

    // ...and Start takes focus back the moment the sheet is dismissed.
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.getByRole("button", { name: "Start" })).toHaveFocus();
  });

  it("labels the help control with a word, not just a glyph", () => {
    render(<TicTacToeRoute seats={SEATS} onExit={vi.fn()} />);

    // The accessible name comes from visible text (UX_PRINCIPLES §9): an
    // icon-only "?" is exactly the kind of control pilot users had to be told
    // about.
    const control = screen.getByRole("button", { name: "Rules" });
    expect(control).toHaveTextContent("Rules");
  });
});
