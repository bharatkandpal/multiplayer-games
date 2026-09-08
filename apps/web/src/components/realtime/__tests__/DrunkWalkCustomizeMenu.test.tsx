import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DrunkWalkCustomizeMenu } from "../DrunkWalkCustomizeMenu";
import { DEFAULT_DRUNK_WALK_CHARACTER, DRUNK_WALK_COSMETICS } from "../drunkWalkCharacter";

function renderMenu(onChange = vi.fn()) {
  render(
    <DrunkWalkCustomizeMenu
      isOpen
      character={DEFAULT_DRUNK_WALK_CHARACTER}
      onChange={onChange}
      onClose={vi.fn()}
    />,
  );
  return onChange;
}

describe("DrunkWalkCustomizeMenu — rendered from the generic schema (MPG-088-b)", () => {
  it("renders one labelled section per schema slot", () => {
    renderMenu();
    for (const slot of DRUNK_WALK_COSMETICS.slots) {
      expect(screen.getByRole("group", { name: slot.label })).toBeInTheDocument();
    }
  });

  it("renders every option of every slot, named for assistive tech", () => {
    renderMenu();
    for (const slot of DRUNK_WALK_COSMETICS.slots) {
      const group = screen.getByRole("group", { name: slot.label });
      for (const option of slot.options) {
        expect(within(group).getByRole("button", { name: option.name })).toBeInTheDocument();
      }
    }
  });

  it("marks the current pick as pressed — selection is never visual-only", () => {
    renderMenu();
    const hats = screen.getByRole("group", { name: "Hat" });
    // Default hat is "none".
    expect(within(hats).getByRole("button", { name: "None" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(hats).getByRole("button", { name: "Cap" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("emits the full character with just that slot changed", async () => {
    const user = userEvent.setup();
    const onChange = renderMenu();

    const hats = screen.getByRole("group", { name: "Hat" });
    await user.click(within(hats).getByRole("button", { name: "Party Hat" }));

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_DRUNK_WALK_CHARACTER,
      hat: "party-hat",
    });
  });

  it("changes a palette slot the same way it changes a part slot", async () => {
    const user = userEvent.setup();
    const onChange = renderMenu();

    const shoes = screen.getByRole("group", { name: "Shoes" });
    await user.click(within(shoes).getByRole("button", { name: "Gold" }));

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_DRUNK_WALK_CHARACTER,
      shoesId: "gold",
    });
  });
});
