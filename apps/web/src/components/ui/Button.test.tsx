import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its label and fires onClick when activated", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Play</Button>);

    const button = screen.getByRole("button", { name: "Play" });
    await user.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is keyboard-operable (Enter and Space activate it)", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Play</Button>);

    await user.tab();
    expect(screen.getByRole("button", { name: "Play" })).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("sets aria-busy and aria-disabled while loading, blocks onClick, but STAYS focusable", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    // Accessible name includes the loading announcement ("Save Loading"),
    // so match on the only button present rather than an exact name.
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Save");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");

    // Native `disabled` must NOT be used for `loading` alone — that would
    // yank focus to <body> at the exact moment the user needs reassurance.
    expect(button).not.toBeDisabled();

    button.focus();
    expect(button).toHaveFocus();

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is reachable via Tab while loading (does not drop out of tab order)", async () => {
    const user = userEvent.setup();
    render(
      <Button loading onClick={vi.fn()}>
        Save
      </Button>,
    );

    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();
  });

  it("respects an explicit disabled prop", () => {
    render(<Button disabled>Play</Button>);
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  });
});
