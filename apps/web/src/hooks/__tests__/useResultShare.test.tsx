import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLocalResultShare, useResultShareUrl } from "../useResultShare";
import { submitTurnBasedResult } from "../../api/results";
import { mintResultShareUrl } from "../../api/share";
import type { AppliedMove } from "../../game/gameSession";
import type { SeatsConfig } from "../../game/seatConfig";

vi.mock("../../api/results", () => ({ submitTurnBasedResult: vi.fn() }));
vi.mock("../../api/share", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/share")>();
  return { ...actual, mintResultShareUrl: vi.fn() };
});

const SEATS: SeatsConfig = [{ kind: "human" }, { kind: "bot", difficulty: "medium" }];

const MOVE_LOG: AppliedMove<{ cell: number }>[] = [
  { move: { cell: 0 }, player: 1 },
  { move: { cell: 3 }, player: 2 },
];

describe("useResultShareUrl (MPG-131)", () => {
  beforeEach(() => {
    vi.mocked(mintResultShareUrl).mockReset().mockResolvedValue("https://x.test/s/tok");
  });

  it("mints as soon as a result id exists — not on the share tap", async () => {
    // `navigator.share` must be called inside the user's gesture; awaiting a
    // round-trip first silently kills the sheet on some mobile browsers.
    const { result } = renderHook(() => useResultShareUrl("res-1"));
    await waitFor(() => expect(result.current).toBe("https://x.test/s/tok"));
    expect(mintResultShareUrl).toHaveBeenCalledWith("res-1");
  });

  it("drops the URL when the id clears, so one game's link can't be shared under the next", async () => {
    const { result, rerender } = renderHook(({ id }) => useResultShareUrl(id), {
      initialProps: { id: "res-1" as string | undefined },
    });
    await waitFor(() => expect(result.current).toBeDefined());

    rerender({ id: undefined });
    expect(result.current).toBeUndefined();
  });

  it("yields no URL when minting fails — sharing degrades, it never errors", async () => {
    vi.mocked(mintResultShareUrl).mockResolvedValue(undefined);
    const { result } = renderHook(() => useResultShareUrl("res-1"));
    await waitFor(() => expect(mintResultShareUrl).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });
});

describe("useLocalResultShare (MPG-131)", () => {
  beforeEach(() => {
    vi.mocked(mintResultShareUrl).mockReset().mockResolvedValue("https://x.test/s/tok");
    vi.mocked(submitTurnBasedResult)
      .mockReset()
      .mockResolvedValue({ ok: true, resultId: "res-local" });
  });

  function options(overrides: Record<string, unknown> = {}) {
    return {
      gameId: "tictactoe",
      seats: SEATS,
      moveLog: MOVE_LOG,
      isGameOver: true,
      ...overrides,
    };
  }

  it("reports the finished game, then shares the link minted for it", async () => {
    const { result } = renderHook(() => useLocalResultShare(options()));

    await waitFor(() => expect(result.current).toBe("https://x.test/s/tok"));
    expect(submitTurnBasedResult).toHaveBeenCalledWith(
      "tictactoe",
      expect.objectContaining({
        // The 1-based `player` IS the seat slot the server replays against.
        moveLog: [
          { slot: 1, move: { cell: 0 } },
          { slot: 2, move: { cell: 3 } },
        ],
        seatsSnapshot: [
          { slot: 1, kind: "human" },
          { slot: 2, kind: "bot", difficulty: "medium" },
        ],
      }),
    );
    expect(mintResultShareUrl).toHaveBeenCalledWith("res-local");
  });

  it("submits nothing while the game is still being played", async () => {
    renderHook(() => useLocalResultShare(options({ isGameOver: false })));
    expect(submitTurnBasedResult).not.toHaveBeenCalled();
  });

  it("submits exactly once per finished game, however often it re-renders", async () => {
    const { rerender } = renderHook((props) => useLocalResultShare(props), {
      initialProps: options(),
    });
    await waitFor(() => expect(submitTurnBasedResult).toHaveBeenCalledTimes(1));

    rerender(options());
    rerender(options());
    expect(submitTurnBasedResult).toHaveBeenCalledTimes(1);
  });

  it("arms again for the next game, and drops the finished game's link", async () => {
    const { result, rerender } = renderHook((props) => useLocalResultShare(props), {
      initialProps: options(),
    });
    await waitFor(() => expect(result.current).toBeDefined());

    // Rematch: back to a live board.
    rerender(options({ isGameOver: false }));
    expect(result.current).toBeUndefined();

    // ...and the next result submits on its own merits.
    rerender(options());
    await waitFor(() => expect(submitTurnBasedResult).toHaveBeenCalledTimes(2));
  });

  it("skips all-bot sessions — 'two bots played' is nobody's brag", async () => {
    renderHook(() => useLocalResultShare(options({ enabled: false })));
    expect(submitTurnBasedResult).not.toHaveBeenCalled();
  });

  it("skips a game with no moves — there is nothing to replay", async () => {
    renderHook(() => useLocalResultShare(options({ moveLog: [] })));
    expect(submitTurnBasedResult).not.toHaveBeenCalled();
  });

  it("stays silent when the service is down — the finished game is unaffected", async () => {
    vi.mocked(submitTurnBasedResult).mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useLocalResultShare(options()));
    await waitFor(() => expect(warn).toHaveBeenCalled());

    // No share URL, and — critically — no throw and no error state to render.
    expect(result.current).toBeUndefined();
    expect(mintResultShareUrl).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("never blocks: the result is available before any network call settles", async () => {
    let release!: () => void;
    vi.mocked(submitTurnBasedResult).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true, resultId: "res-local" });
      }),
    );

    // The hook renders (and the game-over screen with it) with the submission
    // still in flight — sharing arrives late, the result never waits on it.
    const { result } = renderHook(() => useLocalResultShare(options()));
    expect(result.current).toBeUndefined();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(result.current).toBe("https://x.test/s/tok"));
  });
});
