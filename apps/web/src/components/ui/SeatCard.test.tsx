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

  it("shows a decorative thinking spinner only when active and thinking", () => {
    const { container: notThinking } = render(
      <SeatCard seatIndex={1} kind="bot" active thinking={false} />,
    );
    expect(notThinking.querySelector('[class*="spinner"]')).toBeNull();

    const { container: thinking } = render(<SeatCard seatIndex={1} kind="bot" active thinking />);
    const spinner = thinking.querySelector('[class*="spinner"]');
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveAttribute("aria-hidden", "true");
  });

  it("does not show the thinking spinner for an inactive seat even if thinking is passed", () => {
    const { container } = render(<SeatCard seatIndex={1} kind="bot" active={false} thinking />);
    expect(container.querySelector('[class*="spinner"]')).toBeNull();
  });

  it("shows a crown badge with an accessible 'Winner' name when winner is true", () => {
    const { container } = render(<SeatCard seatIndex={0} kind="human" active={false} winner />);
    expect(container.querySelector('[class*="crown"]')).not.toBeNull();
    // The crown emoji itself is decorative; the accessible name comes from a
    // separate non-visual "Winner" string so it doesn't fight the aria-live
    // result announcement elsewhere.
    expect(screen.getByText("Winner")).toBeInTheDocument();
    expect(container.querySelector('[class*="crown"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("raises the winning card's stacking context (class 'winner') so its crown can render above the full-viewport confetti", () => {
    const { container: notWinner } = render(<SeatCard seatIndex={0} kind="human" active={false} />);
    expect(notWinner.querySelector('[class*="winner"]')).toBeNull();

    const { container } = render(<SeatCard seatIndex={0} kind="human" active={false} winner />);
    const card = container.querySelector('[class*="card"]');
    expect(card?.className).toMatch(/winner/);
  });

  it("shows no crown/'Winner' text when winner is false (default)", () => {
    const { container } = render(<SeatCard seatIndex={0} kind="human" active={false} />);
    expect(container.querySelector('[class*="crown"]')).toBeNull();
    expect(screen.queryByText("Winner")).not.toBeInTheDocument();
  });

  it("keeps the winner crown alongside the active/thinking states without disturbing them", () => {
    const { container } = render(
      <SeatCard seatIndex={1} kind="bot" active thinking winner={false} />,
    );
    expect(container.querySelector('[class*="active"]')).not.toBeNull();
    expect(container.querySelector('[class*="spinner"]')).not.toBeNull();
    expect(container.querySelector('[class*="crown"]')).toBeNull();
  });
});
