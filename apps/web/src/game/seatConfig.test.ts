import { describe, expect, it } from "vitest";
import { createDefaultSeats, describeSeat, type SeatsConfig } from "./seatConfig";

describe("seatConfig — N-seat-generic (MPG-024)", () => {
  it("createDefaultSeats() defaults to 2 seats: human vs. medium bot", () => {
    const seats = createDefaultSeats();
    expect(seats).toHaveLength(2);
    expect(seats[0]).toEqual({ kind: "human" });
    expect(seats[1]).toEqual({ kind: "bot", difficulty: "medium" });
  });

  it("createDefaultSeats(3) yields 3 seats: one human, two medium bots", () => {
    const seats = createDefaultSeats(3);
    expect(seats).toHaveLength(3);
    expect(seats[0]).toEqual({ kind: "human" });
    expect(seats[1]).toEqual({ kind: "bot", difficulty: "medium" });
    expect(seats[2]).toEqual({ kind: "bot", difficulty: "medium" });
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

  it("describeSeat labels bot seats with difficulty and 1-based player number, for any seat index", () => {
    const seats = createDefaultSeats(3); // seat 0: human, seats 1 & 2: medium bots
    expect(describeSeat(seats, 1)).toBe("Medium bot (Player 2)");
    expect(describeSeat(seats, 2)).toBe("Medium bot (Player 3)");
  });

  it("describeSeat labels every seat 'Player k' when more than one seat is human (3-human game)", () => {
    const seats: SeatsConfig = [{ kind: "human" }, { kind: "human" }, { kind: "human" }];
    expect(describeSeat(seats, 0)).toBe("Player 1");
    expect(describeSeat(seats, 1)).toBe("Player 2");
    expect(describeSeat(seats, 2)).toBe("Player 3");
  });
});
