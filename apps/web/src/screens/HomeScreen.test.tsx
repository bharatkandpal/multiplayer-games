import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeScreen } from "./HomeScreen";

describe("HomeScreen", () => {
  it("lists the given games with title, description, and id", () => {
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
    expect(screen.getByText("tictactoe")).toBeInTheDocument();
    expect(screen.getByText("connect4")).toBeInTheDocument();

    // The new move-mode variant (MPG-045-d) is catalogued and shows up too.
    expect(screen.getByText("Move-Mode Tic-Tac-Toe")).toBeInTheDocument();
    expect(screen.getByText("tictactoe-move")).toBeInTheDocument();
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
