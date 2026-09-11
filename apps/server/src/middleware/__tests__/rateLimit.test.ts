import type { Server } from "node:http";

// `Response` here refers to the global (fetch) Response; express's Response is
// aliased to `ExRes` so the two don't collide in this file.
import express, { type Request, type Response as ExRes, type NextFunction } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRateLimiter, noopLimit, type RateLimiterConfig } from "../rateLimit.js";

/** Build a JSON `Response` the middleware can `.json()` and read `.ok`/`.status` from. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createRateLimiter (MPG-021)", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  /**
   * Stand up an app with a fixed session token and one rate-limited route, then
   * return a caller. `config` is forwarded to the limiter (fetch/warn/timeout).
   */
  async function mount(config: RateLimiterConfig): Promise<{
    call: () => Promise<Response>;
    enabled: boolean;
  }> {
    const limiter = createRateLimiter(config);
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: ExRes, next: NextFunction) => {
      req.sessionToken = "sess-1";
      next();
    });
    app.post("/x", limiter.limit("test_policy"), (_req: Request, res: ExRes) => {
      res.json({ ok: true });
    });

    const s = await new Promise<Server>((resolve) => {
      const srv = app.listen(0, () => resolve(srv));
    });
    server = s;
    const address = s.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    return {
      enabled: limiter.enabled,
      call: () => fetch(`${baseUrl}/x`, { method: "POST" }),
    };
  }

  it("is disabled and passes through when no URL is configured", async () => {
    const fetchImpl = vi.fn();
    const { call, enabled } = await mount({ url: undefined, fetchImpl });

    expect(enabled).toBe(false);
    const res = await call();
    expect(res.status).toBe(200);
    // The limiter service is never contacted when disabled.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks with 429 + Retry-After on OUTCOME_THROTTLED", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ outcome: "OUTCOME_THROTTLED", retryAfter: 30 }),
    );
    const { call } = await mount({ url: "http://limiter.test", fetchImpl });

    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    const body = (await res.json()) as { code: string; retryAfter: number };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryAfter).toBe(30);
  });

  it("defaults Retry-After when the service supplies no hint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ outcome: "OUTCOME_THROTTLED" }));
    const { call } = await mount({ url: "http://limiter.test", fetchImpl });

    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("allows the request when not throttled, sending the policy + session id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ outcome: "OUTCOME_OK" }));
    const { call } = await mount({ url: "http://limiter.test/", fetchImpl });

    const res = await call();
    expect(res.status).toBe(200);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    // Trailing slash on the base URL is normalised.
    expect(url).toBe("http://limiter.test/v1/check");
    const sent = JSON.parse(String(init.body)) as {
      buckets: { bucket: { policy: string; dimension: string; id: string }; cost: string }[];
    };
    expect(sent.buckets[0]?.bucket).toEqual({
      policy: "test_policy",
      dimension: "session",
      id: "sess-1",
    });
  });

  it("fails open when the limiter rejects", async () => {
    const warn = vi.fn();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const { call } = await mount({ url: "http://limiter.test", fetchImpl, warn });

    const res = await call();
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalled();
  });

  it("fails open when the limiter responds non-OK", async () => {
    const warn = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 503));
    const { call } = await mount({ url: "http://limiter.test", fetchImpl, warn });

    const res = await call();
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalled();
  });

  it("fails open (allows) when the limiter times out", async () => {
    const warn = vi.fn();
    // Never resolves; only rejects when the middleware aborts it.
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const { call } = await mount({ url: "http://limiter.test", fetchImpl, warn, timeoutMs: 20 });

    const res = await call();
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalled();
  });

  it("exposes a noopLimit that always passes through", async () => {
    const app = express();
    app.post("/x", noopLimit("whatever"), (_req: Request, res: ExRes) => res.json({ ok: true }));
    const s = await new Promise<Server>((resolve) => {
      const srv = app.listen(0, () => resolve(srv));
    });
    server = s;
    const address = s.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${address.port}/x`, { method: "POST" });
    expect(res.status).toBe(200);
  });
});
