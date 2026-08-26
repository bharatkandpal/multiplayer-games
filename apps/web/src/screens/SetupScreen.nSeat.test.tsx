import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupScreen } from "./SetupScreen";

// MPG-024: SetupScreen's seat list is driven entirely by the selected game's
// `playerCount`, never a hardcoded 2. Both real games (Tic-Tac-Toe, Connect
// Four) report playerCount=2, so this stubs a hypothetical 3-player entry to
// prove the screen renders N seats generically — a real 3+ seat game would
// need no SetupScreen change to "just work".
vi.mock("./HomeScreen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./HomeScreen")>();
  return {
    ...actual,
    GAME_CATALOG: {
      ...actual.GAME_CATALOG,
      tictactoe: { ...actual.GAME_CATALOG.tictactoe, playerCount: 3 },
    },
  };
});

describe("SetupScreen — N-seat-generic (MPG-024/MPG-049)", () => {
  it("Play vs Bot preset derives the correct seat count (1 human + 2 bots) for a 3-seat game", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="tictactoe" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Play vs Bot/ }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      { kind: "bot", difficulty: "medium" },
      { kind: "bot", difficulty: "medium" },
    ]);
  });

  it("Play a friend preset derives the correct seat count (3 humans) for a 3-seat game", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="tictactoe" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Play a friend/ }));

    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      { kind: "human" },
      { kind: "human" },
    ]);
  });

  it("Customize renders one seat editor per the game's playerCount (3), each independently configurable", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen gameId="tictactoe" onStart={onStart} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Customize seats" }));

    expect(screen.getByRole("radiogroup", { name: "Player 1 type" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Player 2 type" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Player 3 type" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Player 4 type" })).not.toBeInTheDocument();

    // Default: seat 1 human, seats 2 & 3 medium bots.
    expect(screen.getAllByRole("combobox", { name: "Difficulty" })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Start game" }));
    expect(onStart).toHaveBeenCalledExactlyOnceWith([
      { kind: "human" },
      { kind: "bot", difficulty: "medium" },
      { kind: "bot", difficulty: "medium" },
    ]);
  });
});
