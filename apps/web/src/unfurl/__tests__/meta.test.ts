import { describe, expect, it } from "vitest";

import {
  buildUnfurlMeta,
  escapeHtmlAttr,
  injectUnfurlMeta,
  parseShareRecord,
  renderMetaTags,
  type ShareRecord,
  type UnfurlContext,
} from "../meta";

const CTX: UnfurlContext = {
  token: "tok_abc",
  pageUrl: "https://play.example.com/s/tok_abc",
  apiOrigin: "https://api.example.com",
};

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Multiplayer Games</title>
    <link rel="icon" href="/favicon.svg" />
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("escapeHtmlAttr", () => {
  it("neutralises the characters that break out of a quoted attribute", () => {
    expect(escapeHtmlAttr(`"><script>&`)).toBe("&quot;&gt;&lt;script&gt;&amp;");
  });
});

describe("parseShareRecord", () => {
  it("accepts a result record", () => {
    expect(parseShareRecord({ kind: "result", result: { gameId: "2048" } })).toEqual({
      kind: "result",
      result: { gameId: "2048" },
    });
  });

  it("accepts a leaderboard record", () => {
    expect(parseShareRecord({ kind: "leaderboard", gameId: "connect4", eventId: null })).toEqual({
      kind: "leaderboard",
      gameId: "connect4",
    });
  });

  it("rejects unknown / malformed bodies (the degrade signal)", () => {
    expect(parseShareRecord(null)).toBeNull();
    expect(parseShareRecord("nope")).toBeNull();
    expect(parseShareRecord({ kind: "result" })).toBeNull();
    expect(parseShareRecord({ kind: "leaderboard" })).toBeNull();
    expect(parseShareRecord({ kind: "banana" })).toBeNull();
  });
});

describe("buildUnfurlMeta", () => {
  it("points og:image at the immutable card PNG for a realtime result", () => {
    const record: ShareRecord = {
      kind: "result",
      result: { gameId: "2048", gameFamily: "realtime", score: 12345, status: "complete" },
    };
    const meta = buildUnfurlMeta(record, CTX);
    expect(meta.title).toBe("12,345 points on 2048");
    expect(meta.imageUrl).toBe("https://api.example.com/api/cards/tok_abc.png");
    expect(meta.imageAlt).toBe("12,345 points on 2048");
    expect(meta.url).toBe(CTX.pageUrl);
  });

  it("phrases a turn-based verdict without spoiling the board", () => {
    const record: ShareRecord = {
      kind: "result",
      result: {
        gameId: "connect4",
        gameFamily: "turn-based",
        score: null,
        winnerSlot: 1,
        status: "win",
        seatsSnapshot: [
          { slot: 1, kind: "human" },
          { slot: 2, kind: "bot" },
        ],
      },
    };
    const meta = buildUnfurlMeta(record, CTX);
    expect(meta.title).toBe("Player 1 won at Connect Four");
    expect(meta.description).toContain("vs Bot");
  });

  it("has no image for a leaderboard link — mirrors the card 404 for that kind", () => {
    const record: ShareRecord = { kind: "leaderboard", gameId: "nim" };
    const meta = buildUnfurlMeta(record, CTX);
    expect(meta.title).toBe("Nim leaderboard");
    expect(meta.imageUrl).toBeUndefined();
  });

  it("falls back to the raw id for an unknown game rather than breaking", () => {
    const record: ShareRecord = {
      kind: "result",
      result: { gameId: "mystery", gameFamily: "realtime", score: 7, status: "complete" },
    };
    expect(buildUnfurlMeta(record, CTX).title).toBe("7 points on mystery");
  });
});

describe("renderMetaTags", () => {
  it("emits summary_large_image with escaped values when an image is present", () => {
    const html = renderMetaTags({
      title: `A & "B"`,
      description: "d",
      imageUrl: "https://api.example.com/api/cards/tok.png",
      imageAlt: "alt",
      url: "https://play.example.com/s/tok",
    });
    expect(html).toContain('content="summary_large_image"');
    expect(html).toContain('content="A &amp; &quot;B&quot;"');
    expect(html).toContain('property="og:image"');
    expect(html).not.toContain(`"B"`);
  });

  it("falls back to a plain summary card when there is no image", () => {
    const html = renderMetaTags({ title: "t", description: "d", url: "u" });
    expect(html).toContain('content="summary"');
    expect(html).not.toContain("og:image");
  });
});

describe("injectUnfurlMeta", () => {
  it("replaces the generic title and injects the meta block into <head>", () => {
    const meta = buildUnfurlMeta(
      {
        kind: "result",
        result: { gameId: "2048", gameFamily: "realtime", score: 999, status: "complete" },
      },
      CTX,
    );
    const out = injectUnfurlMeta(SHELL, meta);
    expect(out).toContain("<title>999 points on 2048</title>");
    expect(out).not.toContain("<title>Multiplayer Games</title>");
    expect(out).toContain('property="og:image"');
    // Shell's own asset tags survive untouched — the human boots the same SPA.
    expect(out).toContain('<link rel="icon" href="/favicon.svg" />');
    expect(out).toContain('<div id="root"></div>');
  });

  it("returns the html verbatim when there is no <head> to inject into", () => {
    const noHead = "<html><body>hi</body></html>";
    const meta = buildUnfurlMeta({ kind: "leaderboard", gameId: "nim" }, CTX);
    expect(injectUnfurlMeta(noHead, meta)).toBe(noHead);
  });
});
