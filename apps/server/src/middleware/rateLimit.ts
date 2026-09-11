/**
 * Rate-limit middleware (MPG-021).
 *
 * Fronts the anonymous write endpoints with the project's **in-house rate
 * limiter** — a standalone Go HTTP service (docs/TDD.md §11,
 * https://rate-limiter-seven.vercel.app/getting-started), reached via
 * `POST {url}/v1/check`. We reuse that service rather than building a limiter
 * in-process, per TDD §11 ("do not build one").
 *
 * Two invariants make this safe under the platform's offline / graceful-
 * degradation pillars (see docs/UX_PRINCIPLES.md §7):
 *
 *  1. **Disabled by default.** With no `RATE_LIMITER_URL` configured (local dev,
 *     tests, and any deploy that hasn't wired the service yet), every `limit()`
 *     is a no-op passthrough. Concrete per-policy limits are an operator concern,
 *     configured at deploy time — not baked in here.
 *  2. **Fail-open.** A limiter that is slow, down, or returns anything we can't
 *     read lets the request through (with a warning). Rate limiting is
 *     protection layered on top of the app; it must never become a dependency
 *     that can take writes down.
 *
 * The only outcome that blocks a request is an explicit `OUTCOME_THROTTLED`.
 */

import type { NextFunction, Request, Response } from "express";

/** A slow limiter must never slow a write — cap every check well under human perception. */
const DEFAULT_TIMEOUT_MS = 500;

/** Fallback `Retry-After` (seconds) when the service doesn't supply a hint. */
const DEFAULT_RETRY_AFTER_S = 60;

export interface RateLimiterConfig {
  /**
   * Base URL of the in-house limiter service. When absent the limiter is
   * **disabled** and every middleware is a no-op. Defaults to `RATE_LIMITER_URL`.
   */
  url?: string | undefined;
  /** Per-check timeout in ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Injectable `fetch` (tests). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable warn sink (tests). Defaults to `console.warn`. */
  warn?: (message: string, ...args: unknown[]) => void;
}

/**
 * A `limit(policy)` factory — the shape router modules depend on. Defaulting a
 * router's parameter to {@link noopLimit} keeps existing call sites (and tests)
 * working with rate limiting simply absent.
 */
export type RateLimitFor = (
  policy: string,
) => (req: Request, res: Response, next: NextFunction) => void;

/** A `RateLimitFor` that never limits — the default when no limiter is wired. */
export const noopLimit: RateLimitFor =
  () =>
  (_req: Request, _res: Response, next: NextFunction): void =>
    next();

export interface RateLimiter {
  /** `true` when a service URL is configured and limiting is active. */
  readonly enabled: boolean;
  /**
   * Express middleware enforcing `policy` (a limiter policy name, e.g.
   * `"share_mint"`). No-op when the limiter is disabled.
   */
  limit(policy: string): (req: Request, res: Response, next: NextFunction) => void;
}

/** Best-effort scrape of a retry hint (seconds) from the service response. */
function readRetryAfter(body: unknown): number {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    const candidate = record["retryAfter"] ?? record["retryAfterSeconds"];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.ceil(candidate);
    }
  }
  return DEFAULT_RETRY_AFTER_S;
}

export function createRateLimiter(config: RateLimiterConfig = {}): RateLimiter {
  const url = config.url ?? process.env["RATE_LIMITER_URL"];
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = config.fetchImpl ?? fetch;
  const warn = config.warn ?? console.warn;
  const enabled = typeof url === "string" && url.length > 0;

  const passthrough = (_req: Request, _res: Response, next: NextFunction): void => next();

  return {
    enabled,
    limit(policy: string) {
      if (!enabled) return passthrough;

      const checkUrl = `${url.replace(/\/$/, "")}/v1/check`;

      return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
        // `sessionToken` is always set upstream (createSessionMiddleware mints
        // one when absent); `req.ip` is only a defensive fallback.
        const id = req.sessionToken || req.ip || "unknown";

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        void (async () => {
          try {
            const response = await fetchImpl(checkUrl, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                buckets: [{ bucket: { policy, dimension: "session", id }, cost: "1" }],
              }),
              signal: controller.signal,
            });

            if (!response.ok) {
              // A limiter that errors is treated as absent — fail open.
              warn(`[rateLimit] ${policy}: limiter responded ${response.status}; allowing`);
              next();
              return;
            }

            const body: unknown = await response.json();
            const outcome =
              typeof body === "object" && body !== null
                ? (body as Record<string, unknown>)["outcome"]
                : undefined;

            if (outcome === "OUTCOME_THROTTLED") {
              const retryAfter = readRetryAfter(body);
              res.setHeader("Retry-After", String(retryAfter));
              res.status(429).json({
                code: "RATE_LIMITED",
                message: "Too many requests. Please slow down and try again shortly.",
                retryAfter,
              });
              return;
            }

            next();
          } catch (err) {
            // Timeout (abort), network failure, malformed JSON — all fail open.
            warn(`[rateLimit] ${policy}: limiter unreachable; allowing`, err);
            next();
          } finally {
            clearTimeout(timer);
          }
        })();
      };
    },
  };
}
