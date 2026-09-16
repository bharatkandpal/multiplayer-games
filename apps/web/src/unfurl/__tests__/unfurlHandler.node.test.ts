/**
 * The unfurl shim's handler seam (MPG-135) — `apps/web/api/unfurl.ts`.
 *
 * `meta.ts` is covered next door as pure logic; what is untested until here is
 * the half that only exists in the deployed function: where the origins come
 * from, which failures are allowed to reach the wire, and what a human gets when
 * the backend is down. ADR 0009's rule is that **degradation is the default
 * branch** — a missing token, an unset API origin, a failed/slow/404 resolve, an
 * unreadable body, or a broken shell all serve the *untouched* SPA shell, and
 * nothing here ever 5xxs or blocks the boot.
 *
 * `.node.test.ts`: the handler is node-side code (it reads `process.env` and the
 * `@vercel/node` request types), so tsconfig.api.json typechecks it, not the
 * browser project. `fetch` is stubbed — no test here touches the network.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "../../../api/unfurl";

const SHELL = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head>",
  '    <meta charset="UTF-8" />',
  "    <title>Multiplayer Games</title>",
  '    <script type="module" crossorigin src="/assets/index-abc123.js"></script>',
  "  </head>",
  '  <body><div id="root"></div></body>',
  "</html>",
].join("\n");

const TOKEN = "Ab3-_x".repeat(4);
const API_ORIGIN = "https://api.example.test";
const SELF_ORIGIN = "https://play.example.test";

const ENV_KEYS = ["UNFURL_API_ORIGIN", "API_ORIGIN", "VITE_API_URL"] as const;
const savedEnv = new Map<string, string | undefined>();

/** A `fetch` stand-in: `ok` bodies keyed by URL, anything else 404s. */
interface FetchStub {
  shell?: { ok: boolean; body: string };
  share?: { ok?: boolean; body?: unknown; raw?: string; throws?: Error };
}

let requested: { url: string; hasSignal: boolean }[] = [];

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      requested.push({ url, hasSignal: init?.signal instanceof AbortSignal });

      if (url.endsWith("/index.html")) {
        const shell = stub.shell ?? { ok: true, body: SHELL };
        return { ok: shell.ok, text: async () => shell.body, json: async () => ({}) };
      }

      const share = stub.share;
      if (!share) return { ok: false, text: async () => "", json: async () => ({}) };
      if (share.throws) throw share.throws;
      return {
        ok: share.ok ?? true,
        text: async () => share.raw ?? JSON.stringify(share.body),
        json: async () => {
          if (share.raw !== undefined) return JSON.parse(share.raw) as unknown;
          return share.body;
        },
      };
    }),
  );
}

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function createRes(): { res: VercelResponse; reply: Reply } {
  const reply: Reply = { status: 0, headers: {}, body: "" };
  const res = {
    setHeader(key: string, value: string) {
      reply.headers[key.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      reply.status = code;
      return res;
    },
    send(body: string) {
      reply.body = body;
      return res;
    },
  };
  return { res: res as unknown as VercelResponse, reply };
}

function createReq(query: Record<string, string | string[]>, headers = {}): VercelRequest {
  return {
    query,
    headers: { "x-forwarded-proto": "https", "x-forwarded-host": "play.example.test", ...headers },
  } as unknown as VercelRequest;
}

async function invoke(
  query: Record<string, string | string[]>,
  headers?: Record<string, string>,
): Promise<Reply> {
  const { res, reply } = createRes();
  await handler(createReq(query, headers), res);
  return reply;
}

const shareUrls = (): string[] =>
  requested.filter((r) => r.url.includes("/api/share/")).map((r) => r.url);

beforeEach(() => {
  requested = [];
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env["UNFURL_API_ORIGIN"] = API_ORIGIN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("unfurl shim — a resolvable link", () => {
  it("injects the scraper's tags into the SPA's own shell", async () => {
    stubFetch({
      share: {
        ok: true,
        body: {
          kind: "result",
          result: { gameId: "floppy-birds", gameFamily: "realtime", score: 1234 },
        },
      },
    });

    const reply = await invoke({ token: TOKEN });

    expect(reply.status).toBe(200);
    expect(reply.body).toContain(
      '<meta property="og:title" content="1,234 points on Floppy Birds"',
    );
    expect(reply.body).toContain(`<meta property="og:url" content="${SELF_ORIGIN}/s/${TOKEN}" />`);
    expect(reply.body).toContain(
      `<meta property="og:image" content="${API_ORIGIN}/api/cards/${TOKEN}.png" />`,
    );
    expect(reply.body).toContain('<meta name="twitter:card" content="summary_large_image" />');
    // The human's half of the response is the shell, untouched apart from <title>.
    expect(reply.body).toContain(
      '<script type="module" crossorigin src="/assets/index-abc123.js">',
    );
    expect(reply.body).toContain('<div id="root">');
    expect(reply.body).not.toContain("<title>Multiplayer Games</title>");
  });

  it("serves HTML with a short shared-cache TTL, because links are revocable", async () => {
    stubFetch({ share: { ok: true, body: { kind: "leaderboard", gameId: "connect4" } } });

    const reply = await invoke({ token: TOKEN });

    expect(reply.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(reply.headers["cache-control"]).toBe("public, max-age=0, s-maxage=300");
  });

  it("omits og:image for a leaderboard link, which has no card to point at", async () => {
    stubFetch({ share: { ok: true, body: { kind: "leaderboard", gameId: "connect4" } } });

    const reply = await invoke({ token: TOKEN });

    expect(reply.body).toContain('content="Connect Four leaderboard"');
    expect(reply.body).not.toContain("og:image");
    expect(reply.body).toContain('<meta name="twitter:card" content="summary" />');
  });

  it("arms a timeout on both outbound requests", async () => {
    stubFetch({ share: { ok: true, body: { kind: "leaderboard", gameId: "connect4" } } });

    await invoke({ token: TOKEN });

    expect(requested).toHaveLength(2);
    expect(requested.every((r) => r.hasSignal)).toBe(true);
  });

  it("takes the first value when the token arrives repeated", async () => {
    stubFetch({ share: { ok: true, body: { kind: "leaderboard", gameId: "nim" } } });

    await invoke({ token: [TOKEN, "second"] });

    expect(shareUrls()).toEqual([`${API_ORIGIN}/api/share/${TOKEN}`]);
  });
});

describe("unfurl shim — degrading to the plain shell", () => {
  const CASES: [string, FetchStub][] = [
    ["the backend 404s the token", { share: { ok: false } }],
    ["the resolve fails or times out", { share: { throws: new Error("aborted") } }],
    ["the body is not JSON", { share: { ok: true, raw: "<html>gateway error</html>" } }],
    ["the body is JSON of an unknown shape", { share: { ok: true, body: { kind: "nope" } } }],
    [
      "the body is a result with no result object",
      { share: { ok: true, body: { kind: "result" } } },
    ],
  ];

  it.each(CASES)("serves the untouched shell when %s", async (_name, stub) => {
    stubFetch(stub);

    const reply = await invoke({ token: TOKEN });

    expect(reply.status).toBe(200);
    expect(reply.body).toBe(SHELL);
  });

  it("serves the untouched shell when there is no token", async () => {
    stubFetch({});

    const reply = await invoke({});

    expect(reply.body).toBe(SHELL);
    expect(shareUrls()).toEqual([]); // No token, no backend call.
  });

  it.each([
    ["a path traversal", "../../etc/passwd"],
    ["a slash", "abc/def"],
    ["a query smuggle", "abc?x=1"],
    ["an empty string", ""],
    ["an over-long value", "a".repeat(257)],
  ])("rejects %s without ever calling the backend", async (_name, token) => {
    stubFetch({});

    const reply = await invoke({ token });

    expect(reply.body).toBe(SHELL);
    expect(shareUrls()).toEqual([]);
  });

  it("serves the untouched shell when no API origin is configured", async () => {
    delete process.env["UNFURL_API_ORIGIN"];
    stubFetch({ share: { ok: true, body: { kind: "leaderboard", gameId: "nim" } } });

    const reply = await invoke({ token: TOKEN });

    expect(reply.body).toBe(SHELL);
    expect(shareUrls()).toEqual([]);
  });

  it("serves a valid empty document — never a 5xx — when even the shell is gone", async () => {
    stubFetch({ shell: { ok: false, body: "" } });

    const reply = await invoke({ token: TOKEN });

    expect(reply.status).toBe(200);
    expect(reply.body).toBe("<!doctype html><html><head></head><body></body></html>");
  });

  it("does not throw when the shell fetch itself rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );

    const reply = await invoke({ token: TOKEN });

    expect(reply.status).toBe(200);
    expect(reply.body).toContain("<html>");
  });
});

describe("unfurl shim — origin resolution", () => {
  it("prefers UNFURL_API_ORIGIN, then API_ORIGIN, then VITE_API_URL", async () => {
    process.env["API_ORIGIN"] = "https://second.test";
    process.env["VITE_API_URL"] = "https://third.test";
    stubFetch({ share: { ok: true, body: { kind: "leaderboard", gameId: "nim" } } });

    await invoke({ token: TOKEN });
    expect(shareUrls()).toEqual([`${API_ORIGIN}/api/share/${TOKEN}`]);

    delete process.env["UNFURL_API_ORIGIN"];
    requested = [];
    await invoke({ token: TOKEN });
    expect(shareUrls()).toEqual([`https://second.test/api/share/${TOKEN}`]);

    delete process.env["API_ORIGIN"];
    requested = [];
    await invoke({ token: TOKEN });
    expect(shareUrls()).toEqual([`https://third.test/api/share/${TOKEN}`]);
  });

  it("strips trailing slashes so the resolve URL never doubles up", async () => {
    process.env["UNFURL_API_ORIGIN"] = `${API_ORIGIN}///`;
    stubFetch({
      share: { ok: true, body: { kind: "result", result: { gameId: "nim", winnerSlot: 0 } } },
    });

    const reply = await invoke({ token: TOKEN });

    expect(shareUrls()).toEqual([`${API_ORIGIN}/api/share/${TOKEN}`]);
    expect(reply.body).toContain(`content="${API_ORIGIN}/api/cards/${TOKEN}.png"`);
  });

  it("reads its own origin from the forwarded headers, falling back to host", async () => {
    stubFetch({ share: { ok: true, body: { kind: "leaderboard", gameId: "nim" } } });

    await invoke(
      { token: TOKEN },
      { "x-forwarded-proto": "http", "x-forwarded-host": "localhost:3000" },
    );
    expect(requested[0]?.url).toBe("http://localhost:3000/index.html");

    requested = [];
    const reply = await invoke(
      { token: TOKEN },
      {
        "x-forwarded-proto": undefined as unknown as string,
        "x-forwarded-host": undefined as unknown as string,
        host: "preview.example.test",
      },
    );
    expect(requested[0]?.url).toBe("https://preview.example.test/index.html");
    expect(reply.body).toContain(`content="https://preview.example.test/s/${TOKEN}" />`);
  });
});
