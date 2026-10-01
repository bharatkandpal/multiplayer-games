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
