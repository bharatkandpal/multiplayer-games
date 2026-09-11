import { describe, expect, it } from "vitest";

import { CARD_HEIGHT, CARD_WIDTH, renderResultCard } from "../index.js";
import { renderRealtimeCard, renderTurnBasedCard, describeOpponents } from "../genericCards.js";
import { HERO_SIZE, heroSizeFor } from "../layout.js";
import { formatCount } from "../svg.js";
import type { ResultCardInput } from "../types.js";

const AT = new Date("2026-09-11T09:30:00.000Z");

function realtimeResult(overrides: Partial<ResultCardInput> = {}): ResultCardInput {
  return {
    gameId: "floppy-birds",
    gameFamily: "realtime",
    status: "complete",
    score: 2481,
    winnerSlot: null,
    seatsSnapshot: null,
    durationMs: 103_000,
    createdAt: AT,
    ...overrides,
  };
}

function turnBasedResult(overrides: Partial<ResultCardInput> = {}): ResultCardInput {
  return {
    gameId: "connect4",
    gameFamily: "turn-based",
    status: "win",
    score: null,
    winnerSlot: 1,
    seatsSnapshot: [
      { slot: 1, kind: "human" },
      { slot: 2, kind: "bot", difficulty: "medium" },
    ],
    durationMs: 48_000,
    createdAt: AT,
    ...overrides,
  };
}

describe("renderResultCard (MPG-085-a)", () => {
  it("is deterministic — the same result renders byte-identical output", () => {
    // This is the contract MPG-085-b's `immutable, max-age=1y` rests on. If it ever
    // fails, the cache is unsound, not just the test.
    const a = renderResultCard(realtimeResult());
    const b = renderResultCard(realtimeResult());
    expect(a).toBe(b);

    const c = renderResultCard(turnBasedResult());
    expect(renderResultCard(turnBasedResult())).toBe(c);
  });

  it("renders at the Open Graph canvas size", () => {
    const svg = renderResultCard(realtimeResult());
    expect(svg).toContain(`width="${CARD_WIDTH}"`);
    expect(svg).toContain(`height="${CARD_HEIGHT}"`);
    // 1200x630 — the 1.91:1 that Facebook, X and Slack all size against.
    expect(CARD_WIDTH / CARD_HEIGHT).toBeCloseTo(1.91, 1);
  });

  it("produces well-formed, self-contained SVG with an accessible name", () => {
    const svg = renderResultCard(realtimeResult());
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>2,481 points on Floppy Birds</title>");
    // Nothing external: a card must render with no network and no linked assets.
    expect(svg).not.toMatch(/<image|href=|url\(http/);
  });

  it("leads with the brag and carries no call to action (PRD FR-23)", () => {
    const svg = renderResultCard(realtimeResult());
    expect(svg).toContain(">2,481<");
    // The Wordle rule: the link is the invitation, the card never asks.
    expect(svg).not.toMatch(/play now|click|join|sign up|try it/i);
  });

  it("is spoiler-free — a turn-based card carries the outcome, never the position", () => {
    const svg = renderResultCard(turnBasedResult());
    expect(svg).toContain("Player 1 won");
    // `ResultCardInput` has no `moveLog` at all, so this asserts the type boundary
    // held rather than that someone remembered to strip it.
    expect(svg).not.toContain("moveLog");
    expect(svg).not.toMatch(/cell|column|row \d/i);
  });

  it("never leaks the owner token, even when one is handed in", () => {
    // A `GameResult` is structurally assignable to `ResultCardInput`, so a caller can
    // and will pass the whole row. The card must ignore what it wasn't given access to.
    const withOwner = { ...realtimeResult(), ownerToken: "tok-secret", moveLog: [1, 2, 3] };
    const svg = renderResultCard(withOwner);
    expect(svg).not.toContain("tok-secret");
  });

  it("formats numbers locale-independently", () => {
    // `toLocaleString` would render "2.481" on a host with a German locale, and the
    // card is rendered once on a server whose locale nobody controls.
    expect(renderResultCard(realtimeResult({ score: 1_234_567 }))).toContain(">1,234,567<");
    expect(renderResultCard(realtimeResult({ score: 0 }))).toContain(">0<");
    expect(renderResultCard(realtimeResult({ score: 999 }))).toContain(">999<");
  });

  it("renders the date in UTC, not the host's timezone", () => {
    // 23:30 UTC is already "the next day" in much of the world; the card must not
    // disagree with itself depending on where it rendered.
    const late = realtimeResult({ createdAt: new Date("2026-09-11T23:30:00.000Z") });
    expect(renderResultCard(late)).toContain("11 Sep 2026");
  });

  it("routes each family to its own ground", () => {
    // Cabinet (dark) for real-time, table (light) for turn-based — DESIGN_LANGUAGE §2.
    expect(renderResultCard(realtimeResult())).toContain("#120e1c");
    expect(renderResultCard(turnBasedResult())).toContain("#e9e5ee");
  });

  it("falls back to the generic card for a game with no bespoke renderer", () => {
    expect(renderResultCard(realtimeResult({ gameId: "floppy-birds" }))).toBe(
      renderRealtimeCard(realtimeResult({ gameId: "floppy-birds" })),
    );
    expect(renderResultCard(turnBasedResult({ gameId: "nim" }))).toBe(
      renderTurnBasedCard(turnBasedResult({ gameId: "nim" })),
    );
  });

  it("uses the bespoke card for Drunk Walk", () => {
    const svg = renderResultCard(realtimeResult({ gameId: "drunk-walk", score: 412 }));
    expect(svg).toContain("steps before falling over");
    expect(svg).toContain(">412<");
    // The motif, not just a relabelled generic card: the road's asphalt and the two
    // Okabe–Ito tap zones the player was choosing between all run.
    expect(svg).toContain("#3f4045");
    expect(svg).toContain("#0072b2");
    expect(svg).toContain("#b34700");
  });

  it("still renders a game this build has never heard of", () => {
    // A missing title is a cosmetic gap; refusing to render would turn it into a
    // broken unfurl for a result that is otherwise perfectly good.
    const svg = renderResultCard(realtimeResult({ gameId: "some-future-game" }));
    expect(svg).toContain("SOME-FUTURE-GAME");
    expect(svg).toContain(">2,481<");
  });

  it("reads a draw and an unfinished game correctly", () => {
    expect(renderResultCard(turnBasedResult({ status: "draw", winnerSlot: null }))).toContain(
      "Draw",
    );
    expect(
      renderResultCard(turnBasedResult({ status: "in_progress", winnerSlot: null })),
    ).toContain("Unfinished");
  });

  it("keeps the hero at full size for every value the catalogue can actually produce", () => {
    // The longest real heroes are a 9-digit score and "Player 1 won"; both fit, so no
    // card in the catalogue today is silently shrunk.
    expect(heroSizeFor(formatCount(987_654_321), true)).toBe(HERO_SIZE);
    expect(heroSizeFor("Player 1 won", false)).toBe(HERO_SIZE);
  });

  it("shrinks a hero that would otherwise run off the edge", () => {
    // Cached immutably means an overflowing card can't be fixed without minting a new
    // URL, so the estimate only ever errs toward smaller.
    const long = "Player 1 won an extremely long verdict";
    const size = heroSizeFor(long, false);
    expect(size).toBeLessThan(HERO_SIZE);
    // Still large enough to read at feed-thumbnail scale.
    expect(size).toBeGreaterThanOrEqual(56);
    // And it stays an integer, so the output remains stable and diffable.
    expect(Number.isInteger(size)).toBe(true);
  });

  it("is built entirely from fills — nothing depends on stroke support", () => {
    // Found by rendering: a previewer that ignored strokes dropped the whole Drunk Walk
    // figure while every string assertion still passed. MPG-085-b has not picked a
    // rasteriser yet, so the card assumes only the best-supported part of the format.
    for (const svg of [
      renderResultCard(realtimeResult({ gameId: "drunk-walk" })),
      renderResultCard(realtimeResult()),
      renderResultCard(turnBasedResult()),
    ]) {
      expect(svg).not.toContain("stroke=");
      // `<line` alone would also match `<linearGradient`, which is legitimately used.
      expect(svg).not.toMatch(/<line[\s/>]/);
    }
  });

  it("escapes XML so a hostile title can't produce an unparseable card", () => {
    const svg = renderResultCard(realtimeResult({ gameId: `a&b<c>"d"` }));
    expect(svg).toContain("&amp;");
    expect(svg).not.toMatch(/<c>/);
  });

  describe("describeOpponents", () => {
    it("names the common shapes", () => {
      const seats = (kinds: string[]) => kinds.map((kind, i) => ({ slot: i + 1, kind }));
      expect(describeOpponents(seats(["human", "bot"]))).toBe("vs Bot");
      expect(describeOpponents(seats(["human", "human"]))).toBe("2 players");
      expect(describeOpponents(seats(["bot", "bot"]))).toBe("bots only");
      expect(describeOpponents(seats(["human", "bot", "bot"]))).toBe("vs 2 bots");
    });

    it("says nothing rather than guessing when the snapshot is unreadable", () => {
      // A wrong opponent on a card someone is about to show their friends is worse
      // than one fewer line.
      expect(describeOpponents(null)).toBe("");
      expect(describeOpponents("two players")).toBe("");
      expect(describeOpponents([{ slot: 1 }, { slot: 2 }])).toBe("");
    });
  });

  it("omits the opponent line entirely when seats are unreadable", () => {
    const svg = renderResultCard(turnBasedResult({ seatsSnapshot: undefined }));
    // Falls back to the game title rather than rendering an empty line.
    expect(svg).toContain("Connect Four");
    expect(svg).not.toContain("undefined");
    expect(svg).not.toContain("NaN");
  });
});
