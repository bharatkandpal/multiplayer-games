import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupScreen } from "./SetupScreen";
import type { SeatsConfig } from "../game";

describe("SetupScreen", () => {
  it("leads with two one-tap presets: Play vs Bot and Play a friend", () => {
    render(<SetupScreen gameId="tictactoe" onStart={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Play vs Bot/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play a friend/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Set up Tic-Tac-Toe" })).toBeInTheDocument();
  });

  it("Play vs Bot starts immediately with human vs. medium bot", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="tictactoe" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Play vs Bot/ }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      { kind: "bot", difficulty: "medium" },
    ] satisfies SeatsConfig);
  });

  it("Play a friend starts immediately with all-human seats", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="connect4" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Play a friend/ }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      { kind: "human" },
    ] satisfies SeatsConfig);
  });

  it("Customize is collapsed by default and expands on toggle", async () => {
    const user = userEvent.setup();
    render(<SetupScreen gameId="tictactoe" onStart={vi.fn()} onBack={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: "Customize seats" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radiogroup", { name: "Player 1 type" })).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const player1Group = screen.getByRole("radiogroup", { name: "Player 1 type" });
    expect(within(player1Group).getByRole("radio", { name: "Human" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Difficulty" })).toHaveValue("medium");
  });

  it("customized seats: calls onStart with the current seat configuration", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="connect4" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Customize seats" }));
    await user.click(screen.getByRole("button", { name: "Start game" }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      { kind: "bot", difficulty: "medium" },
    ] satisfies SeatsConfig);
  });

  it("switching a seat to Bot reveals a difficulty select, defaulting to medium", async () => {
    const user = userEvent.setup();
    render(<SetupScreen gameId="tictactoe" onStart={vi.fn()} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Customize seats" }));
    const player1Group = screen.getByRole("radiogroup", { name: "Player 1 type" });
    await user.click(within(player1Group).getByRole("radio", { name: "Bot" }));

    const selects = screen.getAllByRole("combobox", { name: "Difficulty" });
    expect(selects).toHaveLength(2);
  });

  it("changing difficulty and starting reflects the chosen level", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="tictactoe" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Customize seats" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Difficulty" }), "hard");
    await user.click(screen.getByRole("button", { name: "Start game" }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      { kind: "bot", difficulty: "hard" },
    ] satisfies SeatsConfig);
  });

  it("supports configuring both seats as humans (local PvP) via Customize", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="tictactoe" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Customize seats" }));
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
