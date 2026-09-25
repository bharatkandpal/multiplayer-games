import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ticTacToe } from "@mpg/engine";
import type { TicTacToeMove, TicTacToeState } from "@mpg/engine";
import { createGameSession, gameSessionReducer } from "../../game/gameSession";
import type { GameSessionState } from "../../game/gameSession";
import type { UseOnlineGameResult } from "../../hooks/useOnlineGame";
import { TicTacToeOnlineRoute } from "../games";

/**
 * Builds a fake `UseOnlineGameResult` — since the screen now receives the
 * whole `useOnlineGame()` result as a prop (`App.tsx` owns the one real
 * instance), these tests exercise `OnlineGamePlayScreen`/`TicTacToeOnlineRoute`
 * purely against that surface, with no Ably/network mocking needed at all.
 */
function makeOnline(overrides: Partial<UseOnlineGameResult> = {}): UseOnlineGameResult {
  const session: GameSessionState<TicTacToeState, TicTacToeMove> = {
    ...createGameSession(ticTacToe),
    status: { type: "playing" },
  };
  return {
    phase: "playing",
    gameId: "tictactoe",
    roomId: "room-1",
    inviteUrl: "http://localhost/tictactoe/room/room-1",
    yourSlot: 1,
    peerConnected: true,
    connectionState: "connected",
    session: session as unknown as UseOnlineGameResult["session"],
    turn: 1,
    yourTurn: true,
    moveLog: [],
    opponentDisconnected: false,
    error: undefined,
    clearError: vi.fn(),
    makeMove: vi.fn(),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
    ...overrides,
  };
}

describe("OnlineGamePlayScreen — via TicTacToeOnlineRoute", () => {
  it("renders the board and sends a move on click", async () => {
    const user = userEvent.setup();
    const makeMove = vi.fn();
    const online = makeOnline({ makeMove });

    render(
      <TicTacToeOnlineRoute
        seats={[{ kind: "human" }, { kind: "human" }]}
        online={online}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Player 1's turn").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("gridcell", { name: "Row 1, column 1, empty" }));

    expect(makeMove).toHaveBeenCalledWith({ cell: 0 });
  });

  it("shows a 'connecting' state while the room isn't playing yet", () => {
    render(
      <TicTacToeOnlineRoute
        seats={[{ kind: "human" }, { kind: "human" }]}
        online={makeOnline({ phase: "waiting", session: undefined, yourTurn: false })}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByText("Waiting for your opponent…")).toBeInTheDocument();
  });

  it("shows an 'opponent disconnected' banner without hiding the board", () => {
    render(
      <TicTacToeOnlineRoute
        seats={[{ kind: "human" }, { kind: "human" }]}
        online={makeOnline({ opponentDisconnected: true })}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByText(/waiting for them to reconnect/i)).toBeInTheDocument();
    // The board itself stays up — never a blocked/dead-end screen.
    expect(screen.getAllByRole("gridcell").length).toBeGreaterThan(0);
  });

  it("shows an unavailable state with a way home instead of a dead end", async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();

    render(
      <TicTacToeOnlineRoute
        seats={[{ kind: "human" }, { kind: "human" }]}
        online={makeOnline({ phase: "unavailable", session: undefined })}
        onExit={onExit}
      />,
    );

    expect(screen.getByText("Online play isn't available right now.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /back to home/i }));
    expect(onExit).toHaveBeenCalled();
  });

  it("reflects the opponent's move once reconciled into the session", () => {
    const nextState = gameSessionReducer(createGameSession(ticTacToe), {
      type: "apply_remote_move",
      move: { cell: 4 },
      player: 1,
    });

    render(
      <TicTacToeOnlineRoute
        seats={[{ kind: "human" }, { kind: "human" }]}
        online={makeOnline({
          yourSlot: 2,
          turn: 2,
          yourTurn: true,
          session: nextState as unknown as UseOnlineGameResult["session"],
        })}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByRole("gridcell", { name: /Row 2, column 2, X/ })).toBeInTheDocument();
    expect(screen.getAllByText("Player 2's turn").length).toBeGreaterThan(0);
  });
});
