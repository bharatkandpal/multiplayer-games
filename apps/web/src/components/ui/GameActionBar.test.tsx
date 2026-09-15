import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameActionBar } from "./GameActionBar";

describe("GameActionBar (MPG-136)", () => {
  it("names each neighbouring game in visible text, not an icon alone", () => {
    render(
      <GameActionBar
        navigation={{
          previous: { title: "Nim", onSelect: vi.fn() },
          next: { title: "Gomoku", onSelect: vi.fn() },
        }}
      />,
    );

    // The accessible name comes from the visible label — which is the point:
    // a sighted first-timer and a screen-reader user read the same thing.
    expect(screen.getByRole("button", { name: /Nim/ })).toHaveTextContent("Nim");
    expect(screen.getByRole("button", { name: /Gomoku/ })).toHaveTextContent("Gomoku");
  });

  it("switches game on activation", async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(
      <GameActionBar
        navigation={{
          previous: { title: "Nim", onSelect: onPrevious },
          next: { title: "Gomoku", onSelect: onNext },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Nim/ }));
    await user.click(screen.getByRole("button", { name: /Gomoku/ }));

    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("offers the opponent switch with a visible label", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<GameActionBar opponent={{ icon: "🤖", label: "Play vs Bot", onSelect }} />);

    await user.click(screen.getByRole("button", { name: /Play vs Bot/ }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("leaves a slot empty rather than showing a dead control (watch / online)", () => {
    render(<GameActionBar navigation={{ next: { title: "Gomoku", onSelect: vi.fn() } }} />);

    expect(screen.getByRole("button", { name: /Gomoku/ })).toBeInTheDocument();
    // No opponent to switch and nowhere previous to go: nothing disabled, nothing there.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders nothing at all when there is nowhere to go and nothing to switch", () => {
    const { container } = render(<GameActionBar />);
    expect(container).toBeEmptyDOMElement();
  });
});
