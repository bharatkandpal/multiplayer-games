import { describe, it, expect, beforeEach } from "vitest";
import type { GameModule } from "./types";
import { registerGame, getGame, hasGame, listGames, clearRegistry } from "./registry";

// A minimal fake game to exercise the registry. It also proves a concrete
// GameModule<S, M> is assignable to the registry's opaque module type.
const fakeGame: GameModule<number, number> = {
  id: "tictactoe",
  playerCount: 2,
  createInitialState: () => 0,
  legalMoves: (state) => (state === 0 ? [1] : []),
  applyMove: (state, move, _player) => state + move,
  getResult: (state) => (state > 0 ? { status: "win", winner: 1 } : { status: "in_progress" }),
  currentPlayer: (state) => (state % 2) + 1,
  evaluate: (state, forPlayer) => state * forPlayer,
};

describe("registry", () => {
  beforeEach(() => clearRegistry());

  it("registers and retrieves a game by id", () => {
    registerGame(fakeGame);
    expect(getGame("tictactoe")).toBe(fakeGame);
    expect(hasGame("tictactoe")).toBe(true);
    expect(listGames()).toEqual(["tictactoe"]);
  });

  it("throws on duplicate registration", () => {
    registerGame(fakeGame);
    expect(() => registerGame(fakeGame)).toThrow(/already registered/);
  });

  it("throws when getting an unregistered game", () => {
    expect(hasGame("connect4")).toBe(false);
    expect(() => getGame("connect4")).toThrow(/Unknown game/);
  });

  it("starts empty and clears", () => {
    expect(listGames()).toEqual([]);
    registerGame(fakeGame);
    clearRegistry();
    expect(listGames()).toEqual([]);
  });
});
