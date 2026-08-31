import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LeaderboardScreen } from "../LeaderboardScreen";

const STORAGE_KEY = "mpg_session_token";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

describe("LeaderboardScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("shows a loading state, then renders the table", async () => {
    window.localStorage.setItem(STORAGE_KEY, "tok-me");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        entries: [
          {
            id: "e1",
            gameId: "tictactoe",
            metric: "wld",
            eventId: null,
            timeBucket: null,
            ownerToken: "tok-me",
            wins: 3,
            losses: 1,
            draws: 0,
            bestScore: null,
            totalGames: 4,
            runId: null,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "e2",
            gameId: "tictactoe",
            metric: "wld",
            eventId: null,
            timeBucket: null,
            ownerToken: "tok-other",
            wins: 1,
            losses: 2,
            draws: 0,
            bestScore: null,
            totalGames: 3,
            runId: null,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        yourRank: 1,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<LeaderboardScreen gameId="tictactoe" gameTitle="Tic-Tac-Toe" onBack={() => {}} />);

    expect(screen.getByRole("status")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText(/Player tok-ot/)).toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    // header row + 2 data rows
    expect(rows).toHaveLength(3);

    const selfRow = screen.getByText("You").closest("tr");
    expect(selfRow).toHaveAttribute("aria-current", "true");
  });

  it("highlights the current player's row and shows accessible column headers", async () => {
    window.localStorage.setItem(STORAGE_KEY, "tok-me");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          entries: [
            {
              id: "e1",
              gameId: "tictactoe",
              metric: "wld",
              eventId: null,
              timeBucket: null,
              ownerToken: "tok-me",
              wins: 2,
              losses: 0,
              draws: 0,
              bestScore: null,
              totalGames: 2,
              runId: null,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          yourRank: 1,
        }),
      ),
    );

    render(<LeaderboardScreen gameId="tictactoe" gameTitle="Tic-Tac-Toe" onBack={() => {}} />);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    expect(screen.getByRole("columnheader", { name: "Rank" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Player" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Wins" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Games" })).toBeInTheDocument();
  });

  it("shows an error state with a retry that re-fetches", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({ entries: [], yourRank: undefined }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LeaderboardScreen gameId="tictactoe" gameTitle="Tic-Tac-Toe" onBack={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Couldn't load/)).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText(/No games played yet/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows an empty state when no entries exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ entries: [], yourRank: undefined })),
    );

    render(<LeaderboardScreen gameId="tictactoe" gameTitle="Tic-Tac-Toe" onBack={() => {}} />);

    await waitFor(() => expect(screen.getByText(/No games played yet/)).toBeInTheDocument());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the real username on the current player's row when one is set", async () => {
    window.localStorage.setItem(STORAGE_KEY, "tok-me");
    window.localStorage.setItem("mpg_username", JSON.stringify({ name: "bharat_k", confirmed: true }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          entries: [
            {
              id: "e1",
              gameId: "tictactoe",
              metric: "wld",
              eventId: null,
              timeBucket: null,
              ownerToken: "tok-me",
              wins: 2,
              losses: 0,
              draws: 0,
              bestScore: null,
              totalGames: 2,
              runId: null,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            {
              id: "e2",
              gameId: "tictactoe",
              metric: "wld",
              eventId: null,
              timeBucket: null,
              ownerToken: "tok-other",
              wins: 1,
              losses: 1,
              draws: 0,
              bestScore: null,
              totalGames: 2,
              runId: null,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          yourRank: 1,
        }),
      ),
    );

    render(<LeaderboardScreen gameId="tictactoe" gameTitle="Tic-Tac-Toe" onBack={() => {}} />);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    expect(screen.getByText("bharat_k")).toBeInTheDocument();
    expect(screen.queryByText("You")).not.toBeInTheDocument();
    // Other players still get the anonymized fallback — we only know our own name.
    expect(screen.getByText(/Player tok-ot/)).toBeInTheDocument();
  });

  it("falls back to the anonymized 'You' label when no username is set", async () => {
    window.localStorage.setItem(STORAGE_KEY, "tok-me");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          entries: [
            {
              id: "e1",
              gameId: "tictactoe",
              metric: "wld",
              eventId: null,
              timeBucket: null,
              ownerToken: "tok-me",
              wins: 2,
              losses: 0,
              draws: 0,
              bestScore: null,
              totalGames: 2,
              runId: null,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          yourRank: 1,
        }),
      ),
    );

    render(<LeaderboardScreen gameId="tictactoe" gameTitle="Tic-Tac-Toe" onBack={() => {}} />);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("calls onBack when the home button is activated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ entries: [], yourRank: undefined })),
    );
    const onBack = vi.fn();

    render(<LeaderboardScreen gameId="tictactoe" gameTitle="Tic-Tac-Toe" onBack={onBack} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Home" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
