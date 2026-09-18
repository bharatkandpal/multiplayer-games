import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeSwitch } from "./ThemeSwitch";

describe("ThemeSwitch", () => {
  it("is a switch named 'Dark mode', off when light is on screen", () => {
    render(<ThemeSwitch dark={false} onChange={vi.fn()} />);

    const control = screen.getByRole("switch", { name: "Dark mode" });
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  it("reads as on when dark is on screen", () => {
    render(<ThemeSwitch dark onChange={vi.fn()} />);

    expect(screen.getByRole("switch", { name: "Dark mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("asks for dark from light, and light from dark — one press either way", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<ThemeSwitch dark={false} onChange={onChange} />);

    await user.click(screen.getByRole("switch", { name: "Dark mode" }));
    expect(onChange).toHaveBeenLastCalledWith("dark");

    rerender(<ThemeSwitch dark onChange={onChange} />);
    await user.click(screen.getByRole("switch", { name: "Dark mode" }));
    expect(onChange).toHaveBeenLastCalledWith("light");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("is operable from the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemeSwitch dark={false} onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole("switch", { name: "Dark mode" })).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("shows both icons in both states, so the control never depends on hue alone", () => {
    const { container, rerender } = render(<ThemeSwitch dark={false} onChange={vi.fn()} />);
    expect(container.querySelectorAll("svg")).toHaveLength(2);

    rerender(<ThemeSwitch dark onChange={vi.fn()} />);
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });
});
