import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the label text", () => {
    render(<StatusBadge status="success">Connected</StatusBadge>);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("pairs each status with a distinct, decorative icon glyph (not color-only)", () => {
    const { container } = render(<StatusBadge status="danger">Disconnected</StatusBadge>);
    const icon = container.querySelector('[aria-hidden="true"]');

    expect(icon).not.toBeNull();
    expect(icon?.textContent).toBe("✕");
  });

  it("renders a different glyph per status", () => {
    const { container: successContainer } = render(<StatusBadge status="success">A</StatusBadge>);
    const { container: warningContainer } = render(<StatusBadge status="warning">B</StatusBadge>);

    const successIcon = successContainer.querySelector('[aria-hidden="true"]')?.textContent;
    const warningIcon = warningContainer.querySelector('[aria-hidden="true"]')?.textContent;

    expect(successIcon).not.toBe(warningIcon);
  });

  it("renders a decorative busy indicator when `busy` is set, absent otherwise", () => {
    const { container: idle } = render(<StatusBadge status="info">Idle</StatusBadge>);
    expect(idle.querySelector('[class*="thinkingDots"]')).toBeNull();

    const { container: busy } = render(
      <StatusBadge status="info" busy>
        Hard bot is thinking…
      </StatusBadge>,
    );
    const dots = busy.querySelector('[class*="thinkingDots"]');
    expect(dots).not.toBeNull();
    expect(dots).toHaveAttribute("aria-hidden", "true");
  });
});
