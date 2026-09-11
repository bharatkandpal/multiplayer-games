import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ticTacToe } from "@mpg/engine";

import { GamePlayScreen } from "../GamePlayScreen";
import { TicTacToeBoard } from "../../components/board";
import type { SeatsConfig } from "../../game";
import { submitTurnBasedResult } from "../../api/results";
import { mintResultShareUrl } from "../../api/share";

vi.mock("../../api/results", () => ({ submitTurnBasedResult: vi.fn() }));
vi.mock("../../api/share", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/share")>();
  return { ...actual, mintResultShareUrl: vi.fn() };
});

/** Two humans, so the game finishes without any bot pacing to advance. */
const HOT_SEAT: SeatsConfig = [{ kind: "human" }, { kind: "human" }];
const ALL_BOTS: SeatsConfig = [
  { kind: "bot", difficulty: "easy" },
  { kind: "bot", difficulty: "easy" },
];

function renderGame(seats: SeatsConfig = HOT_SEAT) {
  return render(
    <GamePlayScreen
      game={ticTacToe}
      gameTitle="Tic-Tac-Toe"
      seats={seats}
      renderBoard={(props) => <TicTacToeBoard {...props} />}
      describeMove={(move) => `cell ${(move as { cell: number }).cell}`}
      onExit={vi.fn()}
    />,
  );
}

/** Seat 1 takes the top row; seat 2 answers on the middle. Ends 3-in-a-row. */
async function playToWin(): Promise<void> {
  const order = [
    "Row 1, column 1, empty",
    "Row 2, column 1, empty",
    "Row 1, column 2, empty",
    "Row 2, column 2, empty",
    "Row 1, column 3, empty",
  ];
  for (const name of order) {
    await userEvent.click(screen.getByRole("gridcell", { name }));
  }
}

describe("GamePlayScreen — sharing a finished turn-based game (MPG-131)", () => {
  beforeEach(() => {
    vi.mocked(submitTurnBasedResult)
      .mockReset()
      .mockResolvedValue({ ok: true, resultId: "res-local" });
    vi.mocked(mintResultShareUrl).mockReset().mockResolvedValue("https://x.test/s/tok");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers no share affordance while the game is still live", () => {
    renderGame();
    expect(screen.queryByRole("button", { name: /Share|Copy link/ })).not.toBeInTheDocument();
  });

  it("reports the finished game and offers its durable link", async () => {
    renderGame();
    await playToWin();

    // The button appears only once a link exists — it is minted after the
    // result persists, so it arrives a beat after game-over. That's why it is
    // never the primary action.
    const shareButton = await screen.findByRole("button", { name: /Share|Copy link/ });
    expect(shareButton).toBeInTheDocument();

    expect(submitTurnBasedResult).toHaveBeenCalledWith(
      "tictactoe",
      expect.objectContaining({
        moveLog: [
          { slot: 1, move: { cell: 0 } },
          { slot: 2, move: { cell: 3 } },
          { slot: 1, move: { cell: 1 } },
          { slot: 2, move: { cell: 4 } },
          { slot: 1, move: { cell: 2 } },
        ],
      }),
    );
    expect(mintResultShareUrl).toHaveBeenCalledWith("res-local");
  });

  it("the game is fully playable and finishable when the share service is down", async () => {
    vi.mocked(submitTurnBasedResult).mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderGame();
    await playToWin();

    // The result screen is complete and correct: Rematch is there and focused,
    // the outcome was announced. Only the optional share button is missing.
    expect(await screen.findByRole("button", { name: /Rematch/ })).toBeInTheDocument();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Share|Copy link/ })).not.toBeInTheDocument();
  });

  it("does not report an all-bot watch session", async () => {
    renderGame(ALL_BOTS);
    // Nothing to assert beyond the absence: no human played, so there is no
    // result to publish and nothing is sent.
    await waitFor(() => expect(submitTurnBasedResult).not.toHaveBeenCalled());
  });
});
