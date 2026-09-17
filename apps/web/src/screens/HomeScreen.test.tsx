import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeScreen } from "./HomeScreen";

/** Every game card on the page, across all shelves. */
function allCards(): HTMLElement[] {
  return screen
    .getAllByRole("list")
    .flatMap((list) => within(list).getAllByRole("button"))
    .filter((button) => button.textContent !== "Options");
}

/** A card's title — i.e. its accessible name, which `aria-labelledby` points at. */
function cardTitle(card: HTMLElement | undefined): string {
  const id = card?.getAttribute("aria-labelledby") ?? "";
  return document.getElementById(id)?.textContent ?? "";
}

describe("HomeScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("lists the given games with title and thumbnail", () => {
    render(
      <HomeScreen
        games={["tictactoe", "connect4", "tictactoe-move"]}
        onSelectGame={vi.fn()}
        onShowGallery={vi.fn()}
      />,
    );

    expect(screen.getByText("Tic-Tac-Toe")).toBeInTheDocument();
    expect(screen.getByText("Connect Four")).toBeInTheDocument();

    // The new move-mode variant (MPG-045-d) is catalogued and shows up too.
    expect(screen.getByText("Move-Mode Tic-Tac-Toe")).toBeInTheDocument();
  });

  it("bolds the hook phrase in a description that declares one (Gomoku)", () => {
    render(<HomeScreen games={["gomoku"]} onSelectGame={vi.fn()} onShowGallery={vi.fn()} />);

    const emphasis = screen.getByText("five in a row");
    expect(emphasis.tagName).toBe("STRONG");
    // The rest of the sentence still renders around it.
    expect(screen.getByRole("button", { name: "Gomoku" })).toHaveAccessibleDescription(
      /Place stones on a 9x9 board and be the first to line up five in a row/,
    );
  });

  it("shows a thumbnail per card, and the card's accessible name is just the title (MPG-052)", () => {
    render(
      <HomeScreen
        games={["tictactoe", "connect4", "tictactoe-move"]}
        onSelectGame={vi.fn()}
        onShowGallery={vi.fn()}
      />,
    );

    const cards = allCards();
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      const svg = card.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
    }

    // Exact-name lookups: the description and tag chips rendered inside the
    // card are wired through aria-describedby, so they never leak into the name.
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

  // UI-4: the reverse of the old MPG-052 assertion. Every game has always had a
  // written description; Home used to drop it on the floor.
  it("renders each game's description, as the card's accessible description", () => {
    render(
      <HomeScreen
        games={["tictactoe", "connect4"]}
        onSelectGame={vi.fn()}
        onShowGallery={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Classic 3x3. Quick games, easy to teach a bot to play well."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Four" })).toHaveAccessibleDescription(
      /Drop discs, connect four in a row/,
    );
  });

  it("shows an empty-state message and no game list when there are no games", () => {
    render(<HomeScreen games={[]} onSelectGame={vi.fn()} onShowGallery={vi.fn()} />);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText(/No games are available right now/)).toBeInTheDocument();
  });

  it("calls onSelectGame with the game's id when its card is activated", async () => {
    const user = userEvent.setup();
    const onSelectGame = vi.fn();
    render(<HomeScreen games={["connect4"]} onSelectGame={onSelectGame} onShowGallery={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Connect Four/ }));
    expect(onSelectGame).toHaveBeenCalledExactlyOnceWith("connect4");
  });

  // MPG-040f: real-time (arcade) games share Home with turn-based ones, tagged
  // by kind. Since UI-4 they're grouped by discovery shelf rather than family,
  // so the card itself has to carry the family marker.
  it("lists real-time games alongside turn-based ones, tagged 'Solo arcade'", () => {
    render(
      <HomeScreen
        games={["tictactoe", "connect4"]}
        realtimeGames={["floppy-birds"]}
        onSelectGame={vi.fn()}
        onSelectRealtimeGame={vi.fn()}
        onShowGallery={vi.fn()}
      />,
    );

    expect(allCards()).toHaveLength(3); // 2 turn-based + 1 real-time
    expect(screen.getByRole("button", { name: /Floppy Birds/ })).toBeInTheDocument();
    expect(screen.getByText("Solo arcade")).toBeInTheDocument();

    // Every card still carries a decorative, AT-hidden thumbnail.
    const floppySvg = screen.getByRole("button", { name: /Floppy Birds/ }).querySelector("svg");
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

    await user.click(screen.getByRole("button", { name: /Floppy Birds/ }));
    expect(onSelectRealtimeGame).toHaveBeenCalledExactlyOnceWith("floppy-birds");
    expect(onSelectGame).not.toHaveBeenCalled();

    // ...and a turn-based card still goes through onSelectGame.
    await user.click(screen.getByRole("button", { name: /Tic-Tac-Toe/ }));
    expect(onSelectGame).toHaveBeenCalledExactlyOnceWith("tictactoe");
  });

  // MPG-076: a second real-time game (Drunk Walk) coexists with Floppy Birds,
  // following the exact same wiring as the first one.
  it("lists Drunk Walk alongside other real-time games, routed via onSelectRealtimeGame", async () => {
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

    expect(allCards()).toHaveLength(3);

    const drunkCard = screen.getByRole("button", { name: /Drunk Walk/ });
    expect(drunkCard.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    await user.click(drunkCard);
    expect(onSelectRealtimeGame).toHaveBeenCalledExactlyOnceWith("drunk-walk");
  });

  // ── Discovery shelves (MPG-090) ────────────────────────────────────────
  describe("discovery shelves", () => {
    const ALL_GAMES = ["tictactoe", "connect4", "tictactoe-move", "nim", "gomoku"] as const;
    const ALL_REALTIME = ["floppy-birds", "drunk-walk", "reflex-test"] as const;

    function renderFullCatalog(trending?: readonly string[]): void {
      render(
        <HomeScreen
          games={[...ALL_GAMES]}
          realtimeGames={[...ALL_REALTIME]}
          trending={trending as never}
          onSelectGame={vi.fn()}
          onSelectRealtimeGame={vi.fn()}
          onShowGallery={vi.fn()}
        />,
      );
    }

    it("splits Home into Featured and New rather than one undifferentiated grid", () => {
      renderFullCatalog();

      expect(screen.getByRole("region", { name: "Featured" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "New" })).toBeInTheDocument();
      expect(
        within(screen.getByRole("list", { name: "Featured games" })).getAllByRole("button"),
      ).not.toHaveLength(0);
    });

    it("hides Trending entirely until there is real signal to rank it by", () => {
      renderFullCatalog();

      // No stand-in, no placeholder: a "Trending" shelf that is really catalog
      // order teaches the player to distrust every other shelf (MPG-094).
      expect(screen.queryByRole("region", { name: "Trending" })).not.toBeInTheDocument();
    });

    it("renders Trending once ids are supplied, ranked rather than in catalog order", () => {
      // `nim` precedes `gomoku` in the catalog, so a ranking that puts Gomoku
      // first can only have come from the read model.
      renderFullCatalog(["gomoku", "nim"]);

      const trending = screen.getByRole("list", { name: "Trending games" });
      const cards = within(trending).getAllByRole("button");
      expect(cards).toHaveLength(2);
      expect(cardTitle(cards[0])).toBe("Gomoku");
      expect(cardTitle(cards[1])).toBe("Nim");
    });

    it("shows every listed game exactly once across the shelves", () => {
      renderFullCatalog(["nim"]);

      const titles = allCards().map(cardTitle);
      expect(titles).toHaveLength(ALL_GAMES.length + ALL_REALTIME.length);
      expect(new Set(titles).size).toBe(titles.length);
    });

    it("keeps a game reachable even when it is neither featured, trending nor new", () => {
      renderFullCatalog();

      // Move-Mode TTT is an old, unfeatured entry — it must still be on the page.
      expect(screen.getByRole("button", { name: "Move-Mode Tic-Tac-Toe" })).toBeInTheDocument();
    });

    it("puts the most recently added games on the New shelf", () => {
      renderFullCatalog();

      const newest = screen.getByRole("list", { name: "New games" });
      // Reflex Test (2026-09-09) and Gomoku (2026-09-08) are the two most
      // recent additions that aren't already carried by Featured.
      expect(within(newest).getByRole("button", { name: "Reflex Test" })).toBeInTheDocument();
      expect(within(newest).getByRole("button", { name: "Gomoku" })).toBeInTheDocument();
    });
  });

  // ── Game of the day (simple daily randomizer; a real recommender is later) ──
  describe("game of the day", () => {
    it("renders no spotlight shelf when no pick is supplied", () => {
      render(
        <HomeScreen
          games={["tictactoe", "connect4"]}
          onSelectGame={vi.fn()}
          onShowGallery={vi.fn()}
        />,
      );
      expect(screen.queryByRole("region", { name: "Game of the day" })).not.toBeInTheDocument();
    });

    it("spotlights the supplied pick, first, without drawing it twice", () => {
      render(
        <HomeScreen
          games={["tictactoe", "connect4"]}
          gameOfTheDay="connect4"
          onSelectGame={vi.fn()}
          onShowGallery={vi.fn()}
        />,
      );

      const spotlight = screen.getByRole("region", { name: "Game of the day" });
      const card = within(spotlight).getByRole("button");
      expect(cardTitle(card)).toBe("Connect Four");

      // Claimed out of the other shelves — exactly one Connect Four on the page.
      expect(allCards().filter((c) => cardTitle(c) === "Connect Four")).toHaveLength(1);
    });

    it("plays the spotlighted game through the normal card routing", async () => {
      const user = userEvent.setup();
      const onSelectRealtimeGame = vi.fn();
      render(
        <HomeScreen
          games={["tictactoe"]}
          realtimeGames={["2048"]}
          gameOfTheDay="2048"
          onSelectGame={vi.fn()}
          onSelectRealtimeGame={onSelectRealtimeGame}
          onShowGallery={vi.fn()}
        />,
      );

      const spotlight = screen.getByRole("region", { name: "Game of the day" });
      await user.click(within(spotlight).getByRole("button"));
      expect(onSelectRealtimeGame).toHaveBeenCalledExactlyOnceWith("2048");
    });
  });

  // ── Tag chips (UI-4, reading UI-3's data) ──────────────────────────────
  it("renders the derived seat tag and the authored tags on each card", () => {
    render(<HomeScreen games={["connect4"]} onSelectGame={vi.fn()} onShowGallery={vi.fn()} />);

    const card = screen.getByRole("button", { name: "Connect Four" });
    expect(within(card).getByText("2 players")).toBeInTheDocument();
    expect(within(card).getByText("vs bot")).toBeInTheDocument();
    expect(within(card).getByText("Online")).toBeInTheDocument();
  });

  // ── Personal best (UI-4) ───────────────────────────────────────────────
  describe("personal-best chip", () => {
    it("is simply absent until the player has recorded a run", () => {
      render(
        <HomeScreen
          games={[]}
          realtimeGames={["floppy-birds"]}
          onSelectGame={vi.fn()}
          onSelectRealtimeGame={vi.fn()}
          onShowGallery={vi.fn()}
        />,
      );

      expect(screen.queryByText(/Your best/)).not.toBeInTheDocument();
    });

    it("shows the locally stored best, with no network call of any kind", () => {
      window.localStorage.setItem("mpg:best:floppy-birds", "17");
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      render(
        <HomeScreen
          games={[]}
          realtimeGames={["floppy-birds"]}
          onSelectGame={vi.fn()}
          onSelectRealtimeGame={vi.fn()}
          onShowGallery={vi.fn()}
        />,
      );

      const card = screen.getByRole("button", { name: "Floppy Birds" });
      expect(within(card).getByText("17")).toBeInTheDocument();
      // The offline pillar: Home renders its best on first paint, from local
      // storage, never from the leaderboard.
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("is never offered for turn-based games, which have no score", () => {
      window.localStorage.setItem("mpg:best:connect4", "9");

      render(<HomeScreen games={["connect4"]} onSelectGame={vi.fn()} onShowGallery={vi.fn()} />);

      expect(screen.queryByText(/Your best/)).not.toBeInTheDocument();
    });
  });

  // ── Developer chrome (UI-4) ────────────────────────────────────────────
  describe("dev footer", () => {
    it("is hidden by default — a stranger from a share link meets no build stamp", () => {
      render(<HomeScreen games={["tictactoe"]} onSelectGame={vi.fn()} onShowGallery={vi.fn()} />);

      expect(
        screen.queryByRole("button", { name: "View design-system kit" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Engine version/)).not.toBeInTheDocument();
    });

    it("renders under devMode, and the kit link still works", async () => {
      const user = userEvent.setup();
      const onShowGallery = vi.fn();
      render(
        <HomeScreen
          games={["tictactoe"]}
          onSelectGame={vi.fn()}
          onShowGallery={onShowGallery}
          devMode
        />,
      );

      expect(screen.getByText(/Engine version/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "View design-system kit" }));
      expect(onShowGallery).toHaveBeenCalledOnce();
    });
  });

  describe("tag filter (MPG-112 / UI-5)", () => {
    const CATALOGUE = {
      games: ["tictactoe", "connect4", "gomoku"] as const,
      realtimeGames: ["floppy-birds", "reflex-test"] as const,
    };

    function renderHome(props: Record<string, unknown> = {}) {
      const onSelectGame = vi.fn();
      const onConfigureGame = vi.fn();
      render(
        <HomeScreen
          games={[...CATALOGUE.games]}
          realtimeGames={[...CATALOGUE.realtimeGames]}
          onSelectGame={onSelectGame}
          onConfigureGame={onConfigureGame}
          onShowGallery={vi.fn()}
          {...props}
        />,
      );
      return { onSelectGame, onConfigureGame };
    }

    /** The filter row's chips, in render order. */
    function chips(): HTMLElement[] {
      return within(screen.getByRole("group", { name: "Filter games by tag" })).getAllByRole(
        "button",
      );
    }

    const chip = (name: string) =>
      within(screen.getByRole("group", { name: "Filter games by tag" })).getByRole("button", {
        name,
      });

    it("offers only tags a listed game actually carries, All first", () => {
      renderHome();
      // No game in this catalogue is `multiplayer` (no 3-seat game exists yet),
      // so that chip is absent rather than present-and-dead.
      expect(chips().map((c) => c.textContent)).toEqual([
        "All",
        "Solo",
        "2 players",
        "vs bot",
        "Online",
        "Watch",
        "Quick",
        "Endless",
      ]);
    });

    it("starts on All, with the shelves showing and every game reachable", () => {
      renderHome();
      expect(chip("All")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("heading", { name: "Featured" })).toBeInTheDocument();
      expect(allCards()).toHaveLength(5);
    });

    it("collapses the shelves into one flat list, headed by the match count", async () => {
      const user = userEvent.setup();
      renderHome();

      await user.click(chip("Solo"));

      // The shelves are gone — the player has said what they want, so the
      // "what should I play?" framing is no longer what the page is for.
      expect(screen.queryByRole("heading", { name: "Featured" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "2 games" })).toBeInTheDocument();

      const titles = allCards().map(cardTitle);
      expect(titles).toEqual(["Floppy Birds", "Reflex Test"]);
      expect(chip("Solo")).toHaveAttribute("aria-pressed", "true");
      expect(chip("All")).toHaveAttribute("aria-pressed", "false");
    });

    it("says 'game', not 'games', when exactly one matches", async () => {
      const user = userEvent.setup();
      renderHome();

      await user.click(chip("Endless"));
      expect(screen.getByRole("heading", { name: "1 game" })).toBeInTheDocument();
      expect(allCards().map(cardTitle)).toEqual(["Floppy Birds"]);
    });

    it("clears back to the shelves via All", async () => {
      const user = userEvent.setup();
      renderHome();

      await user.click(chip("Quick"));
      expect(screen.queryByRole("heading", { name: "Featured" })).not.toBeInTheDocument();

      await user.click(chip("All"));
      expect(screen.getByRole("heading", { name: "Featured" })).toBeInTheDocument();
      expect(allCards()).toHaveLength(5);
      expect(chip("All")).toHaveAttribute("aria-pressed", "true");
    });

    it("clears by re-pressing the active chip — the most obvious place to undo it", async () => {
      const user = userEvent.setup();
      renderHome();

      await user.click(chip("Online"));
      expect(chip("Online")).toHaveAttribute("aria-pressed", "true");

      await user.click(chip("Online"));
      expect(chip("Online")).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("heading", { name: "Featured" })).toBeInTheDocument();
    });

    it("keeps a filtered card fully playable — quick-start and Options both still work", async () => {
      const user = userEvent.setup();
      const { onSelectGame, onConfigureGame } = renderHome();

      await user.click(chip("2 players"));
      const card = allCards().find((c) => cardTitle(c) === "Connect Four");
      await user.click(card!);
      expect(onSelectGame).toHaveBeenCalledWith("connect4");

      await user.click(
        screen.getByRole("button", {
          name: "Options for Connect Four — play a friend, online, or watch bots",
        }),
      );
      expect(onConfigureGame).toHaveBeenCalledWith("connect4");
    });

    it("offers no filter row when no chip would narrow the page", () => {
      render(<HomeScreen games={["tictactoe"]} onSelectGame={vi.fn()} onShowGallery={vi.fn()} />);
      // One game still carries five tags — but every one of them matches the
      // whole catalogue, so none of them is a filter. A control that cannot
      // change the page is worse than no control.
      expect(screen.queryByRole("group", { name: "Filter games by tag" })).not.toBeInTheDocument();
    });

    it("offers no filter row when the catalogue is empty", () => {
      render(<HomeScreen games={[]} onSelectGame={vi.fn()} onShowGallery={vi.fn()} />);
      expect(screen.queryByRole("group", { name: "Filter games by tag" })).not.toBeInTheDocument();
      expect(screen.getByText(/No games are available right now/)).toBeInTheDocument();
    });
  });
});
