import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton, SkeletonGroup } from "./Skeleton";

describe("Skeleton", () => {
  it("renders as decorative (hidden from the accessibility tree)", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild;
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("applies explicit width/height when provided", () => {
    const { container } = render(<Skeleton width={120} height="2rem" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("2rem");
  });
});

describe("SkeletonGroup", () => {
  it("announces a single loading status for the whole group", () => {
    render(
      <SkeletonGroup label="Loading games…">
        <Skeleton />
        <Skeleton />
      </SkeletonGroup>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading games…");
  });
});
