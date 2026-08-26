import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeatCard } from "./SeatCard";

describe("SeatCard", () => {
  it("labels the seat 'Player N' from its 0-based index", () => {
    render(<SeatCard seatIndex={0} kind="human" active={false} />);
    expect(screen.getByText("Player 1")).toBeInTheDocument();

    render(<SeatCard seatIndex={1} kind="bot" active={false} />);
    expect(screen.getByText("Player 2")).toBeInTheDocument();
  });

  it("shows a robot avatar labelled 'Bot' for a bot seat", () => {
    render(<SeatCard seatIndex={1} kind="bot" active={false} />);
    const avatar = screen.getByRole("img", { name: "Bot" });
    expect(avatar).toHaveTextContent("🤖");
  });

  it("shows a person avatar labelled 'Human' for a human seat", () => {
    render(<SeatCard seatIndex={0} kind="human" active={false} />);
    const avatar = screen.getByRole("img", { name: "Human" });
    expect(avatar).toHaveTextContent("👤");
  });

  it("maps even seat indices to the player-1 avatar tint and odd indices to player-2", () => {
    const { container: seat0 } = render(<SeatCard seatIndex={0} kind="human" active={false} />);
    expect(seat0.querySelector('[class*="avatar1"]')).not.toBeNull();

    const { container: seat1 } = render(<SeatCard seatIndex={1} kind="human" active={false} />);
    expect(seat1.querySelector('[class*="avatar2"]')).not.toBeNull();
  });

  it("cycles the avatar tint for seats beyond the two current player tokens", () => {
    const { container } = render(<SeatCard seatIndex={2} kind="human" active={false} />);
    expect(container.querySelector('[class*="avatar1"]')).not.toBeNull();
  });

  it("applies the active highlight only when it's this seat's turn", () => {
    const { container: idle } = render(<SeatCard seatIndex={0} kind="human" active={false} />);
    expect(idle.querySelector('[class*="active"]')).toBeNull();

    const { container: active } = render(<SeatCard seatIndex={0} kind="human" active />);
    expect(active.querySelector('[class*="active"]')).not.toBeNull();
  });

  it("shows a decorative 'Thinking' hint only when active and thinking", () => {
    const { container: notThinking } = render(
      <SeatCard seatIndex={1} kind="bot" active thinking={false} />,
    );
    expect(notThinking.querySelector('[class*="thinkingDots"]')).toBeNull();

    const { container: thinking } = render(<SeatCard seatIndex={1} kind="bot" active thinking />);
    const dots = thinking.querySelector('[class*="thinkingDots"]');
    expect(dots).not.toBeNull();
    expect(dots?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("does not show the 'Thinking' hint for an inactive seat even if thinking is passed", () => {
    const { container } = render(<SeatCard seatIndex={1} kind="bot" active={false} thinking />);
    expect(container.querySelector('[class*="thinkingDots"]')).toBeNull();
  });
});
