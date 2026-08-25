import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renders engine-backed content (version + registered games)", () => {
    render(<App />);

    expect(screen.getByText("Engine version:")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Available games" })).toBeInTheDocument();
    expect(screen.getByText("tictactoe")).toBeInTheDocument();
    expect(screen.getByText("connect4")).toBeInTheDocument();
  });
});
