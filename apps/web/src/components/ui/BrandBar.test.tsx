import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandBar, BRAND_PROMISE } from "./BrandBar";

describe("BrandBar", () => {
  it("names the product as the page heading and states the promise", () => {
    render(<BrandBar />);
    expect(screen.getByRole("heading", { level: 1, name: "bkGames" })).toBeInTheDocument();
    expect(screen.getByText(BRAND_PROMISE)).toBeInTheDocument();
  });

  it("hides the decorative mark from assistive tech", () => {
    const { container } = render(<BrandBar />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders trailing controls beside the brand", () => {
    render(
      <BrandBar>
        <button type="button">Control</button>
      </BrandBar>,
    );
    expect(screen.getByRole("button", { name: "Control" })).toBeInTheDocument();
  });
});
