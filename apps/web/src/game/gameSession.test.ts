import { describe, expect, it } from "vitest";
import { ticTacToe } from "@mpg/engine";
import type { TicTacToeMove, TicTacToeState } from "@mpg/engine";
import { createGameSession, gameSessionReducer } from "./gameSession";

function play(
  moves: TicTacToeMove[],
): ReturnType<typeof createGameSession<TicTacToeState, TicTacToeMove>> {
  let session = createGameSession(ticTacToe);
  session = gameSessionReducer(session, { type: "start" });
  for (const move of moves) {
    session = gameSessionReducer(session, { type: "apply_local_move", move });
  }
  return session;
}

describe("createGameSession", () => {
  it("starts idle, with the initial state's result and first player's turn", () => {
    const session = createGameSession(ticTacToe);
    expect(session.status).toEqual({ type: "idle" });
    expect(session.result).toEqual({ status: "in_progress" });
    expect(session.turn).toBe(1);
    expect(session.lastMove).toBeNull();
  });
});

describe("gameSessionReducer", () => {
  it("start moves an idle session to playing, and is a no-op once already started", () => {
    const idle = createGameSession(ticTacToe);
    const started = gameSessionReducer(idle, { type: "start" });
    expect(started.status).toEqual({ type: "playing" });

    // Calling `start` again (e.g. duplicate effect) does not change anything.
    const startedAgain = gameSessionReducer(started, { type: "start" });
    expect(startedAgain).toBe(started);
  });

  it("applies a legal optimistic move instantly: updates state, turn, lastMove, status", () => {
    const started = gameSessionReducer(createGameSession(ticTacToe), { type: "start" });
    const next = gameSessionReducer(started, { type: "apply_local_move", move: { cell: 4 } });

    expect(next.state.board[4]).toBe(1);
    expect(next.turn).toBe(2);
    expect(next.lastMove).toEqual({ move: { cell: 4 }, player: 1 });
    expect(next.status).toEqual({ type: "playing" });
    expect(next.result).toEqual({ status: "in_progress" });
  });

  it("detects a win and switches status to game_over with the winner recorded", () => {
    // X: 0, 1, 2 (top row) — O: 3, 4.
    const session = play([
      { cell: 0 }, // X
      { cell: 3 }, // O
      { cell: 1 }, // X
      { cell: 4 }, // O
      { cell: 2 }, // X wins top row
    ]);

    expect(session.result).toMatchObject({ status: "win", winner: 1 });
    expect(session.status).toEqual({ type: "game_over" });
  });

  it("detects a draw", () => {
    // A canonical drawn Tic-Tac-Toe game.
    // X | O | X
    // X | O | O
    // O | X | X
    const session = play([0, 1, 2, 4, 3, 6, 5, 8, 7].map((cell) => ({ cell })));

    expect(session.result).toEqual({ status: "draw", reason: "board-full" });
    expect(session.status).toEqual({ type: "game_over" });
  });

  it("rejects an illegal move (occupied cell) without touching state, and surfaces friendly copy", () => {
    const afterFirst = play([{ cell: 0 }]);
    const rejected = gameSessionReducer(afterFirst, {
      type: "apply_local_move",
      move: { cell: 0 },
    });

    expect(rejected.state).toBe(afterFirst.state); // untouched — nothing to visually revert
    expect(rejected.turn).toBe(afterFirst.turn);
    expect(rejected.status).toEqual({
      type: "error",
      message: "That move isn't allowed there. Try a different spot.",
      reason: "illegal_move",
      rejectedMove: { move: { cell: 0 }, player: 2 },
    });
  });

  it("rejects an out-of-bounds move with the out_of_bounds reason", () => {
    const started = gameSessionReducer(createGameSession(ticTacToe), { type: "start" });
    const rejected = gameSessionReducer(started, {
      type: "apply_local_move",
      move: { cell: 99 },
    });

    expect(rejected.status).toMatchObject({ type: "error", reason: "out_of_bounds" });
  });

  it("rejects a move once the game is over", () => {
    const over = play([0, 3, 1, 4, 2].map((cell) => ({ cell })));
    const rejected = gameSessionReducer(over, { type: "apply_local_move", move: { cell: 8 } });

    expect(rejected.status).toMatchObject({ type: "error", reason: "game_over" });
    expect(rejected.result).toMatchObject({ status: "win", winner: 1 });
  });

  it("set_thinking marks a bot as computing a move without altering state", () => {
    const started = gameSessionReducer(createGameSession(ticTacToe), { type: "start" });
    const thinking = gameSessionReducer(started, { type: "set_thinking", player: 2 });

    expect(thinking.status).toEqual({ type: "thinking", player: 2 });
    expect(thinking.state).toBe(started.state);
  });

  it("clear_error returns to playing (or game_over) from an error state, and is a no-op otherwise", () => {
    const afterFirst = play([{ cell: 0 }]);
    const rejected = gameSessionReducer(afterFirst, {
      type: "apply_local_move",
      move: { cell: 0 },
    });
    const cleared = gameSessionReducer(rejected, { type: "clear_error" });
    expect(cleared.status).toEqual({ type: "playing" });

    // No-op when not currently in an error state.
    const noOp = gameSessionReducer(cleared, { type: "clear_error" });
    expect(noOp).toBe(cleared);
  });

  describe("reconcile (future net hook)", () => {
    it("replaces local state with the authoritative state and recomputes turn/result/status", () => {
      const started = gameSessionReducer(createGameSession(ticTacToe), { type: "start" });
      const optimistic = gameSessionReducer(started, {
        type: "apply_local_move",
        move: { cell: 0 },
      });

      // Server echoes back a *different* authoritative state (e.g. it applied a
      // different, still-legal move than what the client guessed at) — reconcile
      // must fully replace, not merge.
      const authoritative: TicTacToeState = { board: ticTacToe.createInitialState().board.slice() };
      const authBoard = authoritative.board.slice();
      authBoard[4] = 1;
      const reconciled = gameSessionReducer(optimistic, {
        type: "reconcile",
        state: { board: authBoard },
        lastMove: { move: { cell: 4 }, player: 1 },
      });

      expect(reconciled.state.board[4]).toBe(1);
      expect(reconciled.state.board[0]).toBeNull();
      expect(reconciled.turn).toBe(2);
      expect(reconciled.lastMove).toEqual({ move: { cell: 4 }, player: 1 });
      expect(reconciled.status).toEqual({ type: "playing" });
    });

    it("reconcile with a terminal state moves status to game_over", () => {
      const started = gameSessionReducer(createGameSession(ticTacToe), { type: "start" });
      const board = ticTacToe.createInitialState().board.slice();
      board[0] = 1;
      board[1] = 1;
      board[2] = 1;
      const reconciled = gameSessionReducer(started, { type: "reconcile", state: { board } });

      expect(reconciled.status).toEqual({ type: "game_over" });
      expect(reconciled.result).toMatchObject({ status: "win", winner: 1 });
    });

    it("preserves lastMove when reconcile omits it", () => {
      const afterFirst = play([{ cell: 0 }]);
      const reconciled = gameSessionReducer(afterFirst, {
        type: "reconcile",
        state: afterFirst.state,
      });
      expect(reconciled.lastMove).toEqual(afterFirst.lastMove);
    });
  });

  describe("revert (future net hook — rollback on move:rejected)", () => {
    it("rolls back to the given authoritative state and surfaces the rejection as an error", () => {
      const started = gameSessionReducer(createGameSession(ticTacToe), { type: "start" });
      const optimistic = gameSessionReducer(started, {
        type: "apply_local_move",
        move: { cell: 0 },
      });

      // Server rejects: roll back to the pre-move (started) state.
      const reverted = gameSessionReducer(optimistic, {
        type: "revert",
        state: started.state,
        message: "Hold on — it's not your turn yet.",
        reason: "not_your_turn",
        rejectedMove: { move: { cell: 0 }, player: 1 },
      });

      expect(reverted.state).toBe(started.state);
      expect(reverted.state.board[0]).toBeNull();
      expect(reverted.lastMove).toBeNull();
      expect(reverted.turn).toBe(1);
      expect(reverted.status).toEqual({
        type: "error",
        message: "Hold on — it's not your turn yet.",
        reason: "not_your_turn",
        rejectedMove: { move: { cell: 0 }, player: 1 },
      });
    });

    it("omits reason/rejectedMove from status when not provided", () => {
      const started = gameSessionReducer(createGameSession(ticTacToe), { type: "start" });
      const reverted = gameSessionReducer(started, {
        type: "revert",
        state: started.state,
        message: "Something went wrong. Give it another try.",
      });
      expect(reverted.status).toEqual({
        type: "error",
        message: "Something went wrong. Give it another try.",
      });
    });
  });

  describe("reset", () => {
    it("returns to a fresh initial state and idle status when no state is given", () => {
      const played = play([{ cell: 0 }, { cell: 4 }]);
      const reset = gameSessionReducer(played, { type: "reset" });

      expect(reset.state).toEqual(ticTacToe.createInitialState());
      expect(reset.lastMove).toBeNull();
      expect(reset.turn).toBe(1);
      expect(reset.status).toEqual({ type: "idle" });
    });

    it("resets to a given state when provided", () => {
      const played = play([{ cell: 0 }, { cell: 4 }]);
      const customState: TicTacToeState = { board: ticTacToe.createInitialState().board.slice() };
      const reset = gameSessionReducer(played, { type: "reset", state: customState });

      expect(reset.state).toBe(customState);
      expect(reset.status).toEqual({ type: "idle" });
    });
  });
});
