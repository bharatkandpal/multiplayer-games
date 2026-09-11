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

    const list = screen.getByRole("list", { name: "Available games" });
    expect(list).toBeInTheDocument();
    // Scoped to the grid: the same title may also appear in the Game-of-the-day
    // spotlight above it.
    expect(within(list).getByText("Tic-Tac-Toe")).toBeInTheDocument();
    expect(within(list).getByText("Connect Four")).toBeInTheDocument();

    // The new move-mode variant (MPG-045-d) is catalogued and shows up too.
    expect(within(list).getByText("Move-Mode Tic-Tac-Toe")).toBeInTheDocument();
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

  it("no longer shows the game description on the grid cards (it moved to Setup, MPG-052)", () => {
    render(
      <HomeScreen
        games={["tictactoe", "connect4", "tictactoe-move"]}
        onSelectGame={vi.fn()}
        onShowGallery={vi.fn()}
      />,
    );

    // Scoped to the grid: the Game-of-the-day spotlight deliberately shows a
    // description, but the ordinary grid cards must not.
    const list = screen.getByRole("list", { name: "Available games" });
    expect(
      within(list).queryByText("Classic 3x3. Quick games, easy to teach a bot to play well."),
    ).not.toBeInTheDocument();
    expect(
      within(list).queryByText("Drop discs, connect four in a row. 7 columns, 6 rows."),
    ).not.toBeInTheDocument();
  });

  // Game of the day (simple randomizer; a real recommender comes later): one
  // game is spotlighted above the grid, stable within the day, and playable in
  // one tap through the same routing as its grid card.
  it("spotlights a Game of the day and routes its Play button like a normal card", async () => {
    const user = userEvent.setup();
    const onSelectGame = vi.fn();
    const onSelectRealtimeGame = vi.fn();
    render(
      <HomeScreen
        games={["connect4"]}
        realtimeGames={["2048"]}
        onSelectGame={onSelectGame}
        onSelectRealtimeGame={onSelectRealtimeGame}
        onShowGallery={vi.fn()}
      />,
    );

    const spotlight = screen.getByRole("region", { name: "Game of the day" });
    const card = within(spotlight).getByRole("button");
    expect(within(card).getByText("Play now →")).toBeInTheDocument();

    await user.click(card);
    // Exactly one of the two routers fires, matched to the spotlighted family.
    const turnBased = onSelectGame.mock.calls.length;
    const realtime = onSelectRealtimeGame.mock.calls.length;
    expect(turnBased + realtime).toBe(1);
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

    // Scoped to the grid so the Game-of-the-day spotlight (which can hold the
    // same game) doesn't make the button ambiguous.
    const list = screen.getByRole("list", { name: "Available games" });
    await user.click(within(list).getByRole("button", { name: /Connect Four/ }));
    expect(onSelectGame).toHaveBeenCalledExactlyOnceWith("connect4");
  });

  it("calls onShowGallery when the design-system kit link is activated", async () => {
    const user = userEvent.setup();
    const onShowGallery = vi.fn();
    render(
      <HomeScreen games={["tictactoe"]} onSelectGame={vi.fn()} onShowGallery={onShowGallery} />,
    );

    await user.click(screen.getByRole("button", { name: "View design-system kit" }));
    expect(onShowGallery).toHaveBeenCalledOnce();
  });

  // MPG-040f: real-time (arcade) games share the one Home grid, tagged by kind.
  it("lists real-time games alongside turn-based ones in the same grid, tagged 'Solo arcade'", () => {
    render(
      <HomeScreen
        games={["tictactoe", "connect4"]}
        realtimeGames={["floppy-birds"]}
        onSelectGame={vi.fn()}
        onSelectRealtimeGame={vi.fn()}
        onShowGallery={vi.fn()}
      />,
    );

    const list = screen.getByRole("list", { name: "Available games" });
    const cards = within(list).getAllByRole("button");
    expect(cards).toHaveLength(3); // 2 turn-based + 1 real-time, one grid

    // Turn-based cards come first; the real-time card is tagged.
    expect(within(list).getByRole("button", { name: /Floppy Birds/ })).toBeInTheDocument();
    expect(within(list).getByText("Solo arcade")).toBeInTheDocument();

    // Every card still carries a decorative, AT-hidden thumbnail.
    const floppySvg = within(list)
      .getByRole("button", { name: /Floppy Birds/ })
      .querySelector("svg");
    expect(floppySvg).toHaveAttribute("aria-hidden", "true");
  });

  it("routes a real-time card through onSelectRealtimeGame (never onSelectGame)", async () => {
    const user = userEvent.setup();
    const onSelectGame = vi.fn();
    const onSelectRealtimeGame = vi.fn();
    render(
      <HomeScreen
        games={["tictactoe"]}
        realtimeGames={["floppy-birds"]}
        onSelectGame={onSelectGame}
        onSelectRealtimeGame={onSelectRealtimeGame}
        onShowGallery={vi.fn()}
      />,
    );

    const list = screen.getByRole("list", { name: "Available games" });
    await user.click(within(list).getByRole("button", { name: /Floppy Birds/ }));
    expect(onSelectRealtimeGame).toHaveBeenCalledExactlyOnceWith("floppy-birds");
    expect(onSelectGame).not.toHaveBeenCalled();

    // ...and a turn-based card still goes through onSelectGame.
    await user.click(within(list).getByRole("button", { name: /Tic-Tac-Toe/ }));
    expect(onSelectGame).toHaveBeenCalledExactlyOnceWith("tictactoe");
  });

  // MPG-076: a second real-time game (Drunk Walk) coexists with Floppy Birds
  // in the same grid, following the exact same wiring as the first one.
  it("lists Drunk Walk alongside other real-time games, tagged 'Solo arcade', routed via onSelectRealtimeGame", async () => {
    const user = userEvent.setup();
    const onSelectRealtimeGame = vi.fn();
    render(
      <HomeScreen
        games={["tictactoe"]}
        realtimeGames={["floppy-birds", "drunk-walk"]}
        onSelectGame={vi.fn()}
        onSelectRealtimeGame={onSelectRealtimeGame}
        onShowGallery={vi.fn()}
      />,
    );

    const list = screen.getByRole("list", { name: "Available games" });
    expect(within(list).getAllByRole("button")).toHaveLength(3);

    const drunkCard = within(list).getByRole("button", { name: /Drunk Walk/ });
    expect(drunkCard).toBeInTheDocument();
    expect(drunkCard.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    await user.click(drunkCard);
    expect(onSelectRealtimeGame).toHaveBeenCalledExactlyOnceWith("drunk-walk");
  });
});
