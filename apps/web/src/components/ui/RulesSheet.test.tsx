import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RulesSheet } from "./RulesSheet";

const RULES = {
  goal: "Take the last object and you win.",
  steps: ["Pick a pile.", "Take as many as you like from it.", "Last object wins."],
} as const;

describe("RulesSheet (MPG-138)", () => {
  it("names the game it is explaining and lists the goal and steps in order", () => {
    render(<RulesSheet isOpen onClose={vi.fn()} gameTitle="Nim" {...RULES} />);

    expect(screen.getByRole("dialog", { name: "How to play Nim" })).toBeInTheDocument();
    expect(screen.getByText(RULES.goal)).toBeInTheDocument();

    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual([...RULES.steps]);
  });

  it("renders notes when a game has them", () => {
    render(
      <RulesSheet
        isOpen
        onClose={vi.fn()}
        gameTitle="Nim"
        {...RULES}
        notes={["There's a trick."]}
      />,
    );

    expect(screen.getByText("There's a trick.")).toBeInTheDocument();
  });

  it("renders no notes list at all when a game has none", () => {
    render(<RulesSheet isOpen onClose={vi.fn()} gameTitle="Nim" {...RULES} />);

    // Only the ordered steps list exists — no empty section left behind.
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });

  it("dismisses via the primary action", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RulesSheet isOpen onClose={onClose} gameTitle="Nim" {...RULES} />);

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders nothing while closed", () => {
    render(<RulesSheet isOpen={false} onClose={vi.fn()} gameTitle="Nim" {...RULES} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
