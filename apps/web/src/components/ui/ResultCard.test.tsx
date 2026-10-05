import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ResultCard } from "./ResultCard";

describe("ResultCard (MPG-115-a)", () => {
  it("renders eyebrow, headline, detail and actions", () => {
    render(
      <ResultCard eyebrow="Floppy Birds" headline="Scored 42" detail={<p>today</p>} headingAs="h1">
        <button type="button">Play</button>
      </ResultCard>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Scored 42" })).toBeInTheDocument();
    expect(screen.getByText("Floppy Birds")).toBeInTheDocument();
    expect(screen.getByText("today")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("renders the optional context slot only when given", () => {
    const { rerender } = render(<ResultCard headline="Game over" />);
    expect(screen.queryByText("Personal best")).not.toBeInTheDocument();
    rerender(<ResultCard headline="Game over" context={<p>Personal best</p>} />);
    expect(screen.getByText("Personal best")).toBeInTheDocument();
  });
});

describe("ResultCard rank delta (MPG-115-b)", () => {
  it("shows a gentle, accessible delta when the rank improved", () => {
    render(<ResultCard headline="Game over" rankDelta={{ rank: 2, previousRank: 5 }} />);
    expect(screen.getByText("Up 3 places since your last run")).toBeInTheDocument();
    expect(document.querySelector('[data-rank-delta="up"]')).toHaveTextContent("▲3 since last run");
  });

  it("uses singular copy and a down shape when the rank slipped", () => {
    render(<ResultCard headline="Game over" rankDelta={{ rank: 4, previousRank: 3 }} />);
    expect(screen.getByText("Down 1 place since your last run")).toBeInTheDocument();
    expect(document.querySelector('[data-rank-delta="down"]')).toBeInTheDocument();
  });

  it("is absent with no prior rank, no current rank, no change, or no prop", () => {
    const { container, rerender } = render(<ResultCard headline="Game over" />);
    const absent = (): boolean => container.querySelector("[data-rank-delta]") === null;
    expect(absent()).toBe(true);
    rerender(<ResultCard headline="Game over" rankDelta={{ rank: 1 }} />);
    expect(absent()).toBe(true);
    rerender(<ResultCard headline="Game over" rankDelta={{ previousRank: 4 }} />);
    expect(absent()).toBe(true);
    rerender(<ResultCard headline="Game over" rankDelta={{ rank: 3, previousRank: 3 }} />);
    expect(absent()).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
