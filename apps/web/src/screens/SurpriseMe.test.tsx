import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SurpriseMe } from "./SurpriseMe";
import { getSurpriseSpinMs } from "../game/motion";
import type { CatalogEntry } from "./catalog";

vi.mock("../game/motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../game/motion")>();
  return { ...actual, getSurpriseSpinMs: vi.fn(() => 800) };
});

const ENTRIES: CatalogEntry[] = [
  {
    id: "snake",
    title: "Snake",
    description: "Steer a snake.",
    kind: "realtime",
    tags: ["endless"],
    addedOn: "2026-09-17",
  },
  {
    id: "breakout",
    title: "Breakout",
    description: "Break bricks.",
    kind: "realtime",
    tags: ["endless"],
    addedOn: "2026-09-11",
  },
  {
    id: "tictactoe",
    title: "Tic-Tac-Toe",
    description: "Classic 3x3.",
    playerCount: 2,
    kind: "turn-based",
    tags: ["vs-bot"],
    addedOn: "2026-08-25",
  },
];

const dice = (): HTMLElement => screen.getByRole("button");

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getSurpriseSpinMs).mockReturnValue(800);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SurpriseMe", () => {
  it("renders nothing when there is nothing to pick", () => {
    const { container } = render(<SurpriseMe entries={[]} onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("launches a game from the list after the shuffle", () => {
    const onPick = vi.fn();
    render(<SurpriseMe entries={ENTRIES} onPick={onPick} />);

    fireEvent.click(dice());
    // Nothing has launched yet — the shuffle is still running.
    expect(onPick).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(ENTRIES).toContain(onPick.mock.calls[0]?.[0]);
  });

  it("is skippable at any moment — and skipping lands on the SAME game", () => {
    // The pick is made before the animation, so skipping can't change it. That
    // is what makes a delay in front of gameplay acceptable at all.
    const onPick = vi.fn();
    render(<SurpriseMe entries={ENTRIES} onPick={onPick} />);

    fireEvent.click(dice());
    act(() => {
      vi.advanceTimersByTime(180);
    });
    fireEvent.click(dice()); // skip

    expect(onPick).toHaveBeenCalledTimes(1);

    // Letting the original timer elapse must not fire a second launch.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("skips on Escape and on Enter", () => {
    for (const key of ["Escape", "Enter"]) {
      const onPick = vi.fn();
      const { unmount } = render(<SurpriseMe entries={ENTRIES} onPick={onPick} />);
      fireEvent.click(dice());
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.keyDown(window, { key });
      expect(onPick).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it("goes straight to the game under prefers-reduced-motion", () => {
    // `--duration-surprise-spin` is zeroed by the reduced-motion block in
    // tokens.css, so there is no shuffle to sit through.
    vi.mocked(getSurpriseSpinMs).mockReturnValue(0);
    const onPick = vi.fn();
    render(<SurpriseMe entries={ENTRIES} onPick={onPick} />);

    fireEvent.click(dice());
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("never lands on the same game twice in a row", () => {
    vi.mocked(getSurpriseSpinMs).mockReturnValue(0);
    const onPick = vi.fn();
    render(<SurpriseMe entries={ENTRIES} onPick={onPick} />);

    for (let i = 0; i < 40; i += 1) fireEvent.click(dice());

    const picked: CatalogEntry[] = onPick.mock.calls.map((call) => call[0] as CatalogEntry);
    expect(picked).toHaveLength(40);
    for (let i = 1; i < picked.length; i += 1) {
      expect(picked[i]?.id).not.toBe(picked[i - 1]?.id);
    }
  });

  it("relabels itself while shuffling, so the button never lies about what it does", () => {
    render(<SurpriseMe entries={ENTRIES} onPick={vi.fn()} />);
    expect(dice()).toHaveAccessibleName("Surprise me — play a random game");

    fireEvent.click(dice());
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(dice()).toHaveAccessibleName("Skip the shuffle and play now");
  });

  it("shows a game title while shuffling, not a smudged thumbnail", () => {
    render(<SurpriseMe entries={ENTRIES} onPick={vi.fn()} />);
    fireEvent.click(dice());
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const titles = ENTRIES.map((e) => e.title);
    expect(titles.some((title) => dice().textContent?.includes(title))).toBe(true);
  });

  it("announces the pick rather than changing screens silently", () => {
    render(<SurpriseMe entries={ENTRIES} onPick={vi.fn()} />);
    fireEvent.click(dice());
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Picking a game/);
  });

  it("leaves no timer running when it unmounts mid-shuffle", () => {
    const onPick = vi.fn();
    const { unmount } = render(<SurpriseMe entries={ENTRIES} onPick={onPick} />);

    fireEvent.click(dice());
    act(() => {
      vi.advanceTimersByTime(100);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Nothing launched into an unmounted tree.
    expect(onPick).not.toHaveBeenCalled();
  });
});
