import { describe, expect, it } from "vitest";
import { BOT_NAMES } from "./botNames";
import {
  DEFAULT_BOT_DIFFICULTY,
  assignBotNames,
  botDifficultyFor,
  createDefaultSeats,
  describeSeat,
  presetSeats,
  type SeatsConfig,
} from "./seatConfig";

describe("seatConfig — N-seat-generic (MPG-024)", () => {
  it("createDefaultSeats() defaults to 2 seats: human vs. a named bot", () => {
    const seats = createDefaultSeats();
    expect(seats).toHaveLength(2);
    expect(seats[0]).toEqual({ kind: "human" });
    expect(seats[1]).toEqual(
      expect.objectContaining({ kind: "bot", difficulty: DEFAULT_BOT_DIFFICULTY }),
    );
    // Every real-play bot carries a roster name (cosmetic; not difficulty).
    expect(seats[1]).toHaveProperty("name");
    expect(BOT_NAMES).toContain((seats[1] as { name: string }).name);
  });

  it("createDefaultSeats(3) yields 3 seats: one human, two distinctly-named bots", () => {
    const seats = createDefaultSeats(3);
    expect(seats).toHaveLength(3);
    expect(seats[0]).toEqual({ kind: "human" });
    const bot1 = seats[1] as { kind: "bot"; name: string };
    const bot2 = seats[2] as { kind: "bot"; name: string };
    expect(bot1.name).not.toBe(bot2.name); // two bots never share a name
    expect(BOT_NAMES).toContain(bot1.name);
    expect(BOT_NAMES).toContain(bot2.name);
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

  it("describeSeat surfaces a named bot's roster name", () => {
    const seats = assignBotNames([{ kind: "human" }, { kind: "bot", difficulty: "hard" }]);
    expect(describeSeat(seats, 1)).toBe((seats[1] as { name: string }).name);
  });

  it("describeSeat falls back to 'Bot' for a nameless (hand-built) bot seat", () => {
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "bot", difficulty: "hard" }];
    expect(describeSeat(seats, 1)).toBe("Bot");
  });

  it("describeSeat distinguishes multiple nameless bots by 1-based player number", () => {
    const seats: SeatsConfig = [
      { kind: "human" },
      { kind: "bot", difficulty: "hard" },
      { kind: "bot", difficulty: "hard" },
    ];
    expect(describeSeat(seats, 1)).toBe("Bot (Player 2)");
    expect(describeSeat(seats, 2)).toBe("Bot (Player 3)");
  });

  it("assignBotNames leaves humans and already-named bots untouched", () => {
    const seats: SeatsConfig = [
      { kind: "human" },
      { kind: "bot", difficulty: "hard", name: "Zoe" },
    ];
    // Deterministic rng: would pick index 0 if it named anything.
    expect(assignBotNames(seats, () => 0)).toEqual(seats);
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
    expect(createDefaultSeats(2, "nim")[1]).toEqual(
      expect.objectContaining({ kind: "bot", difficulty: "medium" }),
    );
    expect(createDefaultSeats(2, "connect4")[1]).toEqual(
      expect.objectContaining({ kind: "bot", difficulty: "hard" }),
    );
    expect(presetSeats("bot", 2, "nim")[1]).toEqual(
      expect.objectContaining({ kind: "bot", difficulty: "medium" }),
    );
    expect(presetSeats("bot", 2, "connect4")[1]).toEqual(
      expect.objectContaining({ kind: "bot", difficulty: "hard" }),
    );
  });

  it("presetSeats('human') seats every player as human, whatever the game", () => {
    expect(presetSeats("human", 3, "nim")).toEqual([
      { kind: "human" },
      { kind: "human" },
      { kind: "human" },
    ]);
  });
});
