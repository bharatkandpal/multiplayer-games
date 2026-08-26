import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeatCard } from "./SeatCard";

describe("SeatCard", () => {
  it("renders the seat's name and a human/bot label", () => {
    render(<SeatCard seatIndex={0} name="You" kind="human" active={false} />);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Human")).toBeInTheDocument();
  });

  it("labels a bot seat distinctly from a human seat", () => {
    render(<SeatCard seatIndex={1} name="Hard bot (Player 2)" kind="bot" active={false} />);
    expect(screen.getByText("Hard bot (Player 2)")).toBeInTheDocument();
    expect(screen.getByText("Bot")).toBeInTheDocument();
  });

  it("maps even seat indices to the player-1 swatch and odd indices to player-2", () => {
    const { container: seat0 } = render(
      <SeatCard seatIndex={0} name="Player 1" kind="human" active={false} />,
    );
    expect(seat0.querySelector('[class*="swatch1"]')).not.toBeNull();

    const { container: seat1 } = render(
      <SeatCard seatIndex={1} name="Player 2" kind="human" active={false} />,
    );
    expect(seat1.querySelector('[class*="swatch2"]')).not.toBeNull();
  });

  it("cycles the swatch mapping for seats beyond the two current player tokens", () => {
    const { container } = render(<SeatCard seatIndex={2} name="Player 3" kind="human" active={false} />);
    expect(container.querySelector('[class*="swatch1"]')).not.toBeNull();
  });

  it("applies the active highlight only when it's this seat's turn", () => {
    const { container: idle } = render(
      <SeatCard seatIndex={0} name="You" kind="human" active={false} />,
    );
    expect(idle.querySelector('[class*="active"]')).toBeNull();

    const { container: active } = render(
      <SeatCard seatIndex={0} name="You" kind="human" active />,
    );
    expect(active.querySelector('[class*="active"]')).not.toBeNull();
  });

  it("shows a decorative 'Thinking' hint only when active and thinking", () => {
    const { container: notThinking } = render(
      <SeatCard seatIndex={1} name="Hard bot (Player 2)" kind="bot" active thinking={false} />,
    );
    expect(notThinking.querySelector('[class*="thinkingDots"]')).toBeNull();

    const { container: thinking } = render(
      <SeatCard seatIndex={1} name="Hard bot (Player 2)" kind="bot" active thinking />,
    );
    const dots = thinking.querySelector('[class*="thinkingDots"]');
    expect(dots).not.toBeNull();
    expect(dots?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("does not show the 'Thinking' hint for an inactive seat even if thinking is passed", () => {
    const { container } = render(
      <SeatCard seatIndex={1} name="Hard bot (Player 2)" kind="bot" active={false} thinking />,
    );
    expect(container.querySelector('[class*="thinkingDots"]')).toBeNull();
  });
});
