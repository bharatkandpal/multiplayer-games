import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NimState } from "@mpg/engine";
import { NimBoard } from "./NimBoard";

function stateWith(piles: number[], toMove: 1 | 2 = 1): NimState {
  return { piles, toMove };
}

describe("NimBoard", () => {
  it("renders every pile with its current count", () => {
    render(
      <NimBoard
        state={stateWith([1, 3, 5, 7])}
        onMove={vi.fn()}
        disabled={false}
        lastMove={null}
      />,
    );

    expect(screen.getByRole("radio", { name: "Pile 1, 1 object remaining" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Pile 2, 3 objects remaining" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Pile 3, 5 objects remaining" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Pile 4, 7 objects remaining" })).toBeInTheDocument();
  });

  it("renders an empty pile distinctly", () => {
    render(
      <NimBoard
        state={stateWith([0, 3, 5, 7])}
        onMove={vi.fn()}
        disabled={false}
        lastMove={null}
      />,
    );

    expect(screen.getByRole("radio", { name: "Pile 1, empty" })).toBeInTheDocument();
  });

  it("shows the initial 'select a pile' prompt", () => {
    render(
      <NimBoard
        state={stateWith([1, 3, 5, 7])}
        onMove={vi.fn()}
        disabled={false}
        lastMove={null}
      />,
    );

    expect(screen.getAllByText("Select a pile to take from.").length).toBeGreaterThan(0);
  });

  it("selecting a pile marks it checked and reveals the count stepper", async () => {
    const user = userEvent.setup();
    render(
      <NimBoard
        state={stateWith([1, 3, 5, 7])}
        onMove={vi.fn()}
        disabled={false}
        lastMove={null}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Pile 2, 3 objects remaining" }));

    expect(
      screen.getByRole("radio", { name: "Pile 2, 3 objects remaining, selected" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getAllByText("Choose how many to take from pile 2 (1–3).").length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("group", { name: "Take from pile 2" })).toBeInTheDocument();
  });

  it("adjusts the count with the +/- steppers, clamped to the pile size", async () => {
    const user = userEvent.setup();
    render(
      <NimBoard
        state={stateWith([1, 3, 5, 7])}
        onMove={vi.fn()}
        disabled={false}
        lastMove={null}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Pile 2, 3 objects remaining" }));
    const stepper = screen.getByRole("group", { name: "Take from pile 2" });
    const increase = within(stepper).getByRole("button", { name: "Increase count" });
    const decrease = within(stepper).getByRole("button", { name: "Decrease count" });
    const countReadout = within(stepper).getByRole("status");

    expect(countReadout).toHaveTextContent("1");
    await user.click(increase);
    await user.click(increase);
    expect(countReadout).toHaveTextContent("3");
    // Already at the pile's max (3) — a further increase is a no-op (button disabled).
    expect(increase).toBeDisabled();
    await user.click(decrease);
    await user.click(decrease);
    await user.click(decrease);
    // Clamped at a minimum of 1 — decrease disables rather than going to 0.
    expect(decrease).toBeDisabled();
  });

  it("confirming 'Take N' issues the move and resets selection", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <NimBoard state={stateWith([1, 3, 5, 7])} onMove={onMove} disabled={false} lastMove={null} />,
    );

    await user.click(screen.getByRole("radio", { name: "Pile 3, 5 objects remaining" }));
    await user.click(screen.getByRole("button", { name: "Increase count" }));
    await user.click(screen.getByRole("button", { name: "Take 2" }));

    expect(onMove).toHaveBeenCalledExactlyOnceWith({ pile: 2, count: 2 });
    expect(screen.queryByRole("group", { name: "Take from pile 3" })).not.toBeInTheDocument();
  });

  it("cancelling a selection backs out without issuing a move", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <NimBoard state={stateWith([1, 3, 5, 7])} onMove={onMove} disabled={false} lastMove={null} />,
    );

    await user.click(screen.getByRole("radio", { name: "Pile 2, 3 objects remaining" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getAllByText("Select a pile to take from.").length).toBeGreaterThan(0);
  });

  it("pressing Escape while a pile is selected deselects it", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <NimBoard state={stateWith([1, 3, 5, 7])} onMove={onMove} disabled={false} lastMove={null} />,
    );

    await user.click(screen.getByRole("radio", { name: "Pile 2, 3 objects remaining" }));
    await user.keyboard("{Escape}");

    expect(screen.getAllByText("Select a pile to take from.").length).toBeGreaterThan(0);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("activating an empty pile is blocked and shows a warning instead of selecting it", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <NimBoard state={stateWith([0, 3, 5, 7])} onMove={onMove} disabled={false} lastMove={null} />,
    );

    await user.click(screen.getByRole("radio", { name: "Pile 1, empty" }));

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Pile 1 is empty — choose another pile.");
    expect(screen.queryByRole("group", { name: /Take from pile/ })).not.toBeInTheDocument();
  });

  it("when disabled, marks every pile aria-disabled and ignores activation, without removing them from the tab order", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<NimBoard state={stateWith([1, 3, 5, 7])} onMove={onMove} disabled lastMove={null} />);

    const piles = screen.getAllByRole("radio");
    for (const pile of piles) {
      expect(pile).toHaveAttribute("aria-disabled", "true");
      expect(pile).not.toBeDisabled();
    }

    expect(piles[0]).toHaveAttribute("tabindex", "0");
    (piles[0] as HTMLElement).focus();
    expect(piles[0]).toHaveFocus();

    await user.click(piles[1] as HTMLElement);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-disabled", "true");
  });

  it("highlights every winning pile when a winningLine is supplied (game over)", () => {
    render(
      <NimBoard
        state={stateWith([0, 0, 0, 0], 2)}
        onMove={vi.fn()}
        disabled
        lastMove={{ move: { pile: 3, count: 1 }, player: 1 }}
        winningLine={[0, 1, 2, 3]}
      />,
    );

    for (const name of ["Pile 1, empty", "Pile 2, empty", "Pile 3, empty", "Pile 4, empty"]) {
      expect(screen.getByRole("radio", { name }).className).toMatch(/winning/);
    }
  });

  it("supports arrow-key roving-tabindex navigation between piles", async () => {
    const user = userEvent.setup();
    render(
      <NimBoard
        state={stateWith([1, 3, 5, 7])}
        onMove={vi.fn()}
        disabled={false}
        lastMove={null}
      />,
    );

    const first = screen.getByRole("radio", { name: "Pile 1, 1 object remaining" });
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Pile 2, 3 objects remaining" })).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Pile 1, 1 object remaining" })).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByRole("radio", { name: "Pile 4, 7 objects remaining" })).toHaveFocus();
  });

  it("keyboard: selecting a pile via Enter and confirming a take via the stepper buttons issues the move", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <NimBoard state={stateWith([1, 3, 5, 7])} onMove={onMove} disabled={false} lastMove={null} />,
    );

    const pile = screen.getByRole("radio", { name: "Pile 4, 7 objects remaining" });
    pile.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("radio", { name: "Pile 4, 7 objects remaining, selected" }),
    ).toHaveAttribute("aria-checked", "true");

    // Tab order into the revealed stepper: Decrease is disabled at count 1 (so
    // skipped), landing on Increase first, then Take.
    await user.tab(); // Increase
    await user.keyboard("{Enter}"); // bumps count to 2, entirely via keyboard
    await user.tab(); // Take
    await user.keyboard("{Enter}");

    expect(onMove).toHaveBeenCalledExactlyOnceWith({ pile: 3, count: 2 });
  });
});
