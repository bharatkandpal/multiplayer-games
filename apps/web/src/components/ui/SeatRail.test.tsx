import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { SeatsConfig } from "../../game";
import { SeatRail } from "./SeatRail";

const HUMAN_VS_BOT: SeatsConfig = [
  { kind: "human" },
  { kind: "bot", difficulty: "medium", name: "Mika" },
];

/** Seat cards in DOM order — the rail's only structural promise. */
function seatCards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-seat-index]"));
}

describe("SeatRail", () => {
  it("renders one seat card per seat, in board order", () => {
    const { container } = render(<SeatRail seats={HUMAN_VS_BOT} activeSeat={0} />);

    const cards = seatCards(container);
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.dataset["seatIndex"])).toEqual(["0", "1"]);
  });

  it("scales past two seats rather than assuming a 1v1", () => {
    const fourSeats: SeatsConfig = [
      { kind: "human" },
      { kind: "human" },
      { kind: "bot", difficulty: "easy" },
      { kind: "bot", difficulty: "hard" },
    ];

    const { container } = render(<SeatRail seats={fourSeats} activeSeat={2} />);
    expect(seatCards(container)).toHaveLength(4);
  });

  it("shows a bot's roster name and keeps humans positional", () => {
    render(<SeatRail seats={HUMAN_VS_BOT} activeSeat={0} />);

    expect(screen.getByText("Player 1")).toBeInTheDocument();
    expect(screen.getByText("Mika")).toBeInTheDocument();
  });

  it("falls back to the positional label for a bot with no roster name", () => {
    render(
      <SeatRail seats={[{ kind: "human" }, { kind: "bot", difficulty: "easy" }]} activeSeat={0} />,
    );

    expect(screen.getByText("Player 2")).toBeInTheDocument();
  });

  it("highlights exactly the active seat", () => {
    const { container } = render(<SeatRail seats={HUMAN_VS_BOT} activeSeat={1} />);

    const [first, second] = seatCards(container);
    expect(first?.className).not.toMatch(/active/);
    expect(second?.className).toMatch(/active/);
  });

  it("highlights no seat when activeSeat is null — the game-over and no-turn case", () => {
    const { container } = render(<SeatRail seats={HUMAN_VS_BOT} activeSeat={null} />);

    for (const card of seatCards(container)) {
      expect(card.className).not.toMatch(/active/);
    }
  });

  it("puts the thinking spinner on the thinking seat only", () => {
    const { container } = render(<SeatRail seats={HUMAN_VS_BOT} activeSeat={1} thinkingSeat={1} />);

    const [first, second] = seatCards(container);
    expect(first?.querySelector('[class*="spinner"]')).toBeNull();
    expect(second?.querySelector('[class*="spinner"]')).not.toBeNull();
  });

  it("crowns the winning seat, and only that seat", () => {
    const { container } = render(
      <SeatRail seats={HUMAN_VS_BOT} activeSeat={null} winnerSeat={0} />,
    );

    const [first, second] = seatCards(container);
    expect(within(first as HTMLElement).getByText("Winner")).toBeInTheDocument();
    expect(second?.querySelector('[class*="crown"]')).toBeNull();
  });

  it("crowns nobody on a draw (winnerSeat omitted)", () => {
    const { container } = render(<SeatRail seats={HUMAN_VS_BOT} activeSeat={null} />);

    expect(container.querySelector('[class*="crown"]')).toBeNull();
    expect(screen.queryByText("Winner")).not.toBeInTheDocument();
  });

  it("forwards a caller's className so the placing screen keeps owning layout", () => {
    const { container } = render(
      <SeatRail seats={HUMAN_VS_BOT} activeSeat={0} className="placed-by-the-screen" />,
    );

    expect(container.firstElementChild?.className).toMatch(/placed-by-the-screen/);
  });
});
