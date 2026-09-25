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

  it("shows the game's description under the heading (MPG-052)", () => {
    render(<SetupScreen gameId="tictactoe" onStart={vi.fn()} onBack={vi.fn()} />);

    expect(
      screen.getByText("Classic 3x3. Quick games, easy to teach a bot to play well."),
    ).toBeInTheDocument();
  });

  it("Play vs Bot starts immediately with human vs. bot at the game's tuned strength", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="tictactoe" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Play vs Bot/ }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      expect.objectContaining({ kind: "bot", difficulty: "medium" }),
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
    // The difficulty selector is gone entirely — bot strength is per game now.
    expect(screen.queryByRole("combobox", { name: "Difficulty" })).not.toBeInTheDocument();
  });

  it("customized seats: calls onStart with the current seat configuration", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="connect4" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Customize seats" }));
    await user.click(screen.getByRole("button", { name: "Start game" }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      expect.objectContaining({ kind: "bot", difficulty: "hard" }),
    ] satisfies SeatsConfig);
  });

  it("switching a seat to Bot exposes no difficulty control, and uses the game's tuned strength", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="tictactoe" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Customize seats" }));
    const player1Group = screen.getByRole("radiogroup", { name: "Player 1 type" });
    await user.click(within(player1Group).getByRole("radio", { name: "Bot" }));

    expect(screen.queryByRole("combobox", { name: "Difficulty" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Bot difficulty" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start game" }));
    // Both seats are bots now; tictactoe is capped at medium so it stays winnable.
    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ kind: "bot", difficulty: "medium" }),
      expect.objectContaining({ kind: "bot", difficulty: "medium" }),
    ] satisfies SeatsConfig);
  });

  it("a game with no override seats its bot at hard", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="connect4" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Play vs Bot/ }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      expect.objectContaining({ kind: "bot", difficulty: "hard" }),
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

  describe("MPG-025: online routing threads the real seat config through", () => {
    it("the primary 'Play online' button always sends an all-human config, regardless of Customize state", async () => {
      const user = userEvent.setup();
      const onPlayOnline = vi.fn();
      render(
        <SetupScreen
          gameId="tictactoe"
          onStart={vi.fn()}
          onBack={vi.fn()}
          onPlayOnline={onPlayOnline}
        />,
      );

      await user.click(screen.getByRole("button", { name: /^Play online/ }));

      expect(onPlayOnline).toHaveBeenCalledExactlyOnceWith([
        { kind: "human" },
        { kind: "human" },
      ] satisfies SeatsConfig);
    });

    it("Customize's online action sends the current per-seat editor state, once every seat is human", async () => {
      const user = userEvent.setup();
      const onPlayOnline = vi.fn();
      render(
        <SetupScreen
          gameId="tictactoe"
          onStart={vi.fn()}
          onBack={vi.fn()}
          onPlayOnline={onPlayOnline}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Customize seats" }));
      // Online play is human-vs-human only (bots stay local-only, CLAUDE.md) —
      // the default Customize state has seat 2 as a bot, so the online action
      // is hidden until it's switched to Human.
      expect(
        screen.queryByRole("button", { name: "Play online — this setup" }),
      ).not.toBeInTheDocument();
      const player2Group = screen.getByRole("radiogroup", { name: "Player 2 type" });
      await user.click(within(player2Group).getByRole("radio", { name: "Human" }));

      await user.click(screen.getByRole("button", { name: "Play online — this setup" }));

      expect(onPlayOnline).toHaveBeenCalledExactlyOnceWith([
        { kind: "human" },
        { kind: "human" },
      ] satisfies SeatsConfig);
    });

    it("configuring any seat as a bot hides the online action — online play is human-vs-human only", async () => {
      const user = userEvent.setup();
      const onPlayOnline = vi.fn();
      render(
        <SetupScreen
          gameId="tictactoe"
          onStart={vi.fn()}
          onBack={vi.fn()}
          onPlayOnline={onPlayOnline}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Customize seats" }));
      const player1Group = screen.getByRole("radiogroup", { name: "Player 1 type" });
      await user.click(within(player1Group).getByRole("radio", { name: "Bot" }));

      expect(
        screen.queryByRole("button", { name: /^Play online — this setup/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/bot seats play locally only/i)).toBeInTheDocument();
    });

    it("no online action is shown when onPlayOnline is omitted", async () => {
      const user = userEvent.setup();
      render(<SetupScreen gameId="tictactoe" onStart={vi.fn()} onBack={vi.fn()} />);

      expect(screen.queryByRole("button", { name: /Play online/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Customize seats" }));
      expect(
        screen.queryByRole("button", { name: /Play online|Watch online/ }),
      ).not.toBeInTheDocument();
    });
  });
});
