/**
 * The catch-all function's packaging seam (MPG-135).
 *
 * `api/[...path].ts` is deliberately thin — it owns exactly two decisions, and
 * both are the kind that only break in production:
 *
 *   1. **Build once per instance.** The app opens the Neon handle and registers
 *      the engine games, so it must be built on the first invocation and reused
 *      by every warm one — and the *promise* must be cached, not the resolved
 *      app, or two concurrent cold requests each build their own.
 *   2. **Hand the request through untouched.** Every `/api/*` shape the frontend
 *      host rewrites here has to reach the same Express app with its path, query,
 *      method, headers and body intact. Nothing is re-routed in this workspace.
 *
 * The routes themselves are tested where they live (`@mpg/server`); this file is
 * only about the wiring between Vercel's handler contract and that app. The app
 * is mocked so the suite needs no database — the storage-less guard is covered
 * against the real module in `databaseUrlGuard.test.ts`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createServerlessApiApp } = vi.hoisted(() => ({
  createServerlessApiApp: vi.fn(),
}));

vi.mock("@mpg/server/app", () => ({ createServerlessApiApp }));

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;
type App = (req: IncomingMessage, res: ServerResponse) => void;

/** Fresh module state per test — the memoized promise lives at module scope. */
async function loadHandler(): Promise<Handler> {
  vi.resetModules();
  const mod = (await import("../api/[...path].js")) as { default: Handler };
  return mod.default;
}

/** Deferred so a test can hold the build open and start a second invocation. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  createServerlessApiApp.mockReset();
});

describe("catch-all function — app lifecycle", () => {
  it("builds the app on the first invocation and reuses it on warm ones", async () => {
    const app = vi.fn<App>();
    createServerlessApiApp.mockResolvedValue(app);
    const handler = await loadHandler();

    const req = {} as VercelRequest;
    const res = {} as VercelResponse;
    await handler(req, res);
    await handler(req, res);
    await handler(req, res);

    expect(createServerlessApiApp).toHaveBeenCalledTimes(1);
    expect(app).toHaveBeenCalledTimes(3);
  });

  it("shares one build between concurrent cold invocations", async () => {
    // Caching the resolved app instead of the promise would let both of these
    // through the `??=` before either finished, opening two Neon handles.
    const build = deferred<App>();
    createServerlessApiApp.mockReturnValue(build.promise);
    const handler = await loadHandler();

    const first = handler({} as VercelRequest, {} as VercelResponse);
    const second = handler({} as VercelRequest, {} as VercelResponse);

    const app = vi.fn<App>();
    build.resolve(app);
    await Promise.all([first, second]);

    expect(createServerlessApiApp).toHaveBeenCalledTimes(1);
    expect(app).toHaveBeenCalledTimes(2);
  });

  it("passes the platform's own req/res objects straight to the app", async () => {
    const app = vi.fn<App>();
    createServerlessApiApp.mockResolvedValue(app);
    const handler = await loadHandler();

    const req = { url: "/api/health" } as VercelRequest;
    const res = { locals: {} } as unknown as VercelResponse;
    await handler(req, res);

    expect(app).toHaveBeenCalledWith(req, res);
    expect(app.mock.calls[0]?.[0]).toBe(req);
    expect(app.mock.calls[0]?.[1]).toBe(res);
  });

  it("rejects — rather than replying — when the app cannot be built", async () => {
    // A build failure is a dead deployment, and it must look like one: the
    // platform turns a rejected handler into a 5xx. Swallowing it here would
    // hang the request or answer 200 with no app behind it.
    createServerlessApiApp.mockRejectedValue(new Error("DATABASE_URL is required"));
    const handler = await loadHandler();

    await expect(handler({} as VercelRequest, {} as VercelResponse)).rejects.toThrow(
      /DATABASE_URL is required/,
    );
  });
});

describe("catch-all function — request pass-through", () => {
  let server: Server;
  let baseUrl: string;
  let seen: {
    method: string | undefined;
    url: string | undefined;
    auth: string | undefined;
    body: string;
  }[];

  beforeEach(async () => {
    seen = [];
    // Stand in for the Express app: record what arrived and answer, so the
    // assertions are about what survives the trip, not about any route.
    const app: App = (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        seen.push({
          method: req.method,
          url: req.url,
          auth: req.headers["x-session-token"] as string | undefined,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        res.statusCode = 204;
        res.end();
      });
    };
    createServerlessApiApp.mockResolvedValue(app);
    const handler = await loadHandler();

    server = await new Promise<Server>((resolve) => {
      const s = createServer((req, res) => {
        void handler(req as VercelRequest, res as VercelResponse);
      });
      s.listen(0, () => resolve(s));
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a network address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([
    ["/api/health", "the plain endpoint"],
    ["/api/leaderboard?gameId=connect4&limit=10", "a query string"],
    ["/api/share/abc-123_XYZ", "a token path"],
    ["/api/cards/abc-123_XYZ.png", "the unfurl image"],
    ["/api/nope/deeper/still", "an unknown nested path"],
  ])("delivers %s (%s) to the app verbatim", async (path) => {
    const res = await fetch(`${baseUrl}${path}`);

    expect(res.status).toBe(204);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(path);
    expect(seen[0]?.method).toBe("GET");
  });

  it("preserves the method, the identity header and the request body", async () => {
    // Identity travels in a header, not a cookie (see apps/api/README.md), so a
    // dropped header here would silently anonymise every request.
    const res = await fetch(`${baseUrl}/api/results`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-token": "tok-123" },
      body: JSON.stringify({ gameId: "connect4" }),
    });

    expect(res.status).toBe(204);
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.auth).toBe("tok-123");
    expect(seen[0]?.body).toBe('{"gameId":"connect4"}');
  });

  it("still builds the app only once across many real requests", async () => {
    await Promise.all([
      fetch(`${baseUrl}/api/health`),
      fetch(`${baseUrl}/api/healthz`),
      fetch(`${baseUrl}/api/share/abc`),
    ]);

    expect(seen).toHaveLength(3);
    expect(createServerlessApiApp).toHaveBeenCalledTimes(1);
  });
});
