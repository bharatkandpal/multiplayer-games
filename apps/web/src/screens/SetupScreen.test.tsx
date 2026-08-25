import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupScreen } from "./SetupScreen";
import type { SeatsConfig } from "../game";

describe("SetupScreen", () => {
  it("defaults to human (Player 1) vs. medium bot (Player 2)", () => {
    render(<SetupScreen gameId="tictactoe" onStart={vi.fn()} onBack={vi.fn()} />);

    const player1Group = screen.getByRole("radiogroup", { name: "Player 1 type" });
    expect(within(player1Group).getByRole("radio", { name: "Human" })).toBeChecked();

    expect(screen.getByRole("heading", { name: "Set up Tic-Tac-Toe" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Difficulty" })).toHaveValue("medium");
  });

  it("calls onStart with the current seat configuration", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="connect4" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Start game" }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      { kind: "bot", difficulty: "medium" },
    ] satisfies SeatsConfig);
  });

  it("switching a seat to Bot reveals a difficulty select, defaulting to medium", async () => {
    const user = userEvent.setup();
    render(<SetupScreen gameId="tictactoe" onStart={vi.fn()} onBack={vi.fn()} />);

    const player1Group = screen.getByRole("radiogroup", { name: "Player 1 type" });
    await user.click(within(player1Group).getByRole("radio", { name: "Bot" }));

    const selects = screen.getAllByRole("combobox", { name: "Difficulty" });
    expect(selects).toHaveLength(2);
  });

  it("changing difficulty and starting reflects the chosen level", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="tictactoe" onStart={onStart} onBack={vi.fn()} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Difficulty" }), "hard");
    await user.click(screen.getByRole("button", { name: "Start game" }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      { kind: "bot", difficulty: "hard" },
    ] satisfies SeatsConfig);
  });

  it("supports configuring both seats as humans (local PvP)", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="tictactoe" onStart={onStart} onBack={vi.fn()} />);

    const player2Group = screen.getByRole("radiogroup", { name: "Player 2 type" });
    await user.click(within(player2Group).getByRole("radio", { name: "Human" }));
    await user.click(screen.getByRole("button", { name: "Start game" }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      { kind: "human" },
    ] satisfies SeatsConfig);
  });

  it("calls onBack when the back link is activated", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<SetupScreen gameId="tictactoe" onStart={vi.fn()} onBack={onBack} />);

    await user.click(screen.getByRole("button", { name: "← Back to games" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
