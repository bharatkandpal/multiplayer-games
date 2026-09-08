import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOT_DIFFICULTY,
  botDifficultyFor,
  createDefaultSeats,
  describeSeat,
  presetSeats,
  type SeatsConfig,
} from "./seatConfig";

describe("seatConfig — N-seat-generic (MPG-024)", () => {
  it("createDefaultSeats() defaults to 2 seats: human vs. bot", () => {
    const seats = createDefaultSeats();
    expect(seats).toHaveLength(2);
    expect(seats[0]).toEqual({ kind: "human" });
    expect(seats[1]).toEqual({ kind: "bot", difficulty: DEFAULT_BOT_DIFFICULTY });
  });

  it("createDefaultSeats(3) yields 3 seats: one human, two bots", () => {
    const seats = createDefaultSeats(3);
    expect(seats).toHaveLength(3);
    expect(seats[0]).toEqual({ kind: "human" });
    expect(seats[1]).toEqual({ kind: "bot", difficulty: DEFAULT_BOT_DIFFICULTY });
    expect(seats[2]).toEqual({ kind: "bot", difficulty: DEFAULT_BOT_DIFFICULTY });
  });

  it("createDefaultSeats(1) yields a single human seat", () => {
    const seats = createDefaultSeats(1);
    expect(seats).toHaveLength(1);
    expect(seats[0]).toEqual({ kind: "human" });
  });

  it("describeSeat labels a solo human as 'You' regardless of seat count", () => {
    const seats = createDefaultSeats(3); // 1 human, 2 bots
    expect(describeSeat(seats, 0)).toBe("You");
  });

  it("describeSeat names a lone bot just 'Bot' — difficulty is not player-facing", () => {
    const seats = createDefaultSeats(2);
    expect(describeSeat(seats, 1)).toBe("Bot");
  });

  it("describeSeat distinguishes multiple bots by 1-based player number, for any seat index", () => {
    const seats = createDefaultSeats(3); // seat 0: human, seats 1 & 2: bots
    expect(describeSeat(seats, 1)).toBe("Bot (Player 2)");
    expect(describeSeat(seats, 2)).toBe("Bot (Player 3)");
  });

  it("describeSeat labels every seat 'Player k' when more than one seat is human (3-human game)", () => {
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }, { kind: "human" }];
    expect(describeSeat(seats, 0)).toBe("Player 1");
    expect(describeSeat(seats, 1)).toBe("Player 2");
    expect(describeSeat(seats, 2)).toBe("Player 3");
  });
});

describe("seatConfig — bot strength is per game, not player-selected", () => {
  it("defaults to hard for a game with no override", () => {
    expect(DEFAULT_BOT_DIFFICULTY).toBe("hard");
    expect(botDifficultyFor("connect4")).toBe("hard");
    expect(botDifficultyFor("tictactoe-move")).toBe("hard");
  });

  it("falls back to the default when no game is supplied", () => {
    expect(botDifficultyFor()).toBe(DEFAULT_BOT_DIFFICULTY);
  });

  // These two games' Hard tunings are unbeatable rather than merely strong —
  // tictactoe searches its whole ≤9-ply tree, and Nim plays the exact nim-sum
  // optimum from a losing default layout (MPG-083). Overriding them is what
  // keeps a first session winnable; if this test starts failing because an
  // override was removed, the game became unwinnable against its own bot.
  it.each(["tictactoe", "nim"] as const)("keeps %s winnable by capping it below hard", (gameId) => {
    expect(botDifficultyFor(gameId)).toBe("medium");
  });

  it("createDefaultSeats and presetSeats both honour the per-game strength", () => {
    expect(createDefaultSeats(2, "nim")[1]).toEqual({ kind: "bot", difficulty: "medium" });
    expect(createDefaultSeats(2, "connect4")[1]).toEqual({ kind: "bot", difficulty: "hard" });
    expect(presetSeats("bot", 2, "nim")[1]).toEqual({ kind: "bot", difficulty: "medium" });
    expect(presetSeats("bot", 2, "connect4")[1]).toEqual({ kind: "bot", difficulty: "hard" });
  });

  it("presetSeats('human') seats every player as human, whatever the game", () => {
    expect(presetSeats("human", 3, "nim")).toEqual([
      { kind: "human" },
      { kind: "human" },
      { kind: "human" },
    ]);
  });
});
