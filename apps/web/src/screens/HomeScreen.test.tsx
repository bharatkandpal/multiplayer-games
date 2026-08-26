import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeScreen } from "./HomeScreen";

describe("HomeScreen", () => {
  it("lists the given games with title and thumbnail", () => {
    render(
      <HomeScreen
        games={["tictactoe", "connect4", "tictactoe-move"]}
        onSelectGame={vi.fn()}
        onShowGallery={vi.fn()}
      />,
    );

    expect(screen.getByRole("list", { name: "Available games" })).toBeInTheDocument();
    expect(screen.getByText("Tic-Tac-Toe")).toBeInTheDocument();
    expect(screen.getByText("Connect Four")).toBeInTheDocument();

    // The new move-mode variant (MPG-045-d) is catalogued and shows up too.
    expect(screen.getByText("Move-Mode Tic-Tac-Toe")).toBeInTheDocument();
  });

  it("shows a thumbnail per card, and the card's accessible name is just the title (MPG-052)", () => {
    render(
      <HomeScreen
        games={["tictactoe", "connect4", "tictactoe-move"]}
        onSelectGame={vi.fn()}
        onShowGallery={vi.fn()}
      />,
    );

    const list = screen.getByRole("list", { name: "Available games" });
    const cards = within(list).getAllByRole("button");
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      const svg = card.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
    }

    expect(screen.getByRole("button", { name: "Tic-Tac-Toe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Four" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move-Mode Tic-Tac-Toe" })).toBeInTheDocument();
  });

  it("no longer shows the raw engine game id under the title (MPG-052)", () => {
    render(
      <HomeScreen
        games={["tictactoe", "connect4", "tictactoe-move"]}
        onSelectGame={vi.fn()}
        onShowGallery={vi.fn()}
      />,
    );

    expect(screen.queryByText("tictactoe")).not.toBeInTheDocument();
    expect(screen.queryByText("connect4")).not.toBeInTheDocument();
    expect(screen.queryByText("tictactoe-move")).not.toBeInTheDocument();
  });

  it("no longer shows the game description on Home (it moved to Setup, MPG-052)", () => {
    render(
      <HomeScreen
        games={["tictactoe", "connect4", "tictactoe-move"]}
        onSelectGame={vi.fn()}
        onShowGallery={vi.fn()}
      />,
    );

    expect(
      screen.queryByText("Classic 3x3. Quick games, easy to teach a bot to play well."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Drop discs, connect four in a row. 7 columns, 6 rows."),
    ).not.toBeInTheDocument();
  });

  it("shows an empty-state message and no list when there are no games", () => {
    render(<HomeScreen games={[]} onSelectGame={vi.fn()} onShowGallery={vi.fn()} />);

    expect(screen.queryByRole("list", { name: "Available games" })).not.toBeInTheDocument();
    expect(screen.getByText(/No games are available right now/)).toBeInTheDocument();
  });

  it("calls onSelectGame with the game's id when its card is activated", async () => {
    const user = userEvent.setup();
    const onSelectGame = vi.fn();
    render(<HomeScreen games={["connect4"]} onSelectGame={onSelectGame} onShowGallery={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Connect Four/ }));
    expect(onSelectGame).toHaveBeenCalledExactlyOnceWith("connect4");
  });

  it("calls onShowGallery when the design-system kit link is activated", async () => {
    const user = userEvent.setup();
    const onShowGallery = vi.fn();
    render(<HomeScreen games={["tictactoe"]} onSelectGame={vi.fn()} onShowGallery={onShowGallery} />);

    await user.click(screen.getByRole("button", { name: "View design-system kit" }));
    expect(onShowGallery).toHaveBeenCalledOnce();
  });
});
