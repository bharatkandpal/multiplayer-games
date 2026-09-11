import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Game2048CustomizeMenu } from "./Game2048CustomizeMenu";

describe("Game2048CustomizeMenu", () => {
  it("offers 3/4/5 with the current size pressed, and reports a pick", () => {
    const onChange = vi.fn();
    render(<Game2048CustomizeMenu isOpen size={4} onChange={onChange} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /4 by 4/ })).toHaveAttribute("aria-pressed", "true");
    const five = screen.getByRole("button", { name: /5 by 5/ });
    expect(five).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(five);
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("renders no size options when closed", () => {
    render(<Game2048CustomizeMenu isOpen={false} size={4} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /by/ })).not.toBeInTheDocument();
  });
});
