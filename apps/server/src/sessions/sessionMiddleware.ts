/**
 * Session identity middleware — lightweight, opaque, no-PII session tokens.
 *
 * A session token is just a `crypto.randomUUID()`. It is read from the
 * `x-session-token` header or the `mpg_session` cookie; if neither is
 * present, a new one is minted. The token is upserted + touched in the
 * store on every request/connection so `lastSeenAt` stays fresh for
 * retention sweeps.
 *
 */

import type { NextFunction, Request, Response } from "express";

import type { Store } from "../store/ports.js";

export const SESSION_HEADER = "x-session-token";
export const SESSION_COOKIE = "mpg_session";

const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000; // ~400 days (browser cap)

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Opaque per-browser session token, set by `createSessionMiddleware`. */
      sessionToken: string;
    }
  }
}

/** Parse a raw `Cookie` header into a plain key/value map. */
export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;

  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key.length === 0) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }

  return out;
}

/** Extract a session token from a header map (works for HTTP + socket handshakes). */
export function extractSessionToken(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const headerValue = headers[SESSION_HEADER];
  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof headerToken === "string" && headerToken.length > 0) {
    return headerToken;
  }

  const cookieValue = headers["cookie"];
  const cookieHeader = Array.isArray(cookieValue) ? cookieValue[0] : cookieValue;
  const cookies = parseCookies(cookieHeader);
  const cookieToken = cookies[SESSION_COOKIE];
  if (typeof cookieToken === "string" && cookieToken.length > 0) {
    return cookieToken;
  }

  return undefined;
}

/**
 * Express middleware: resolves (or mints) the session token for `req`,
 * upserts + touches it in the store, and mirrors it back via header + cookie.
 */
export function createSessionMiddleware(store: Store) {
  return async function sessionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const existing = extractSessionToken(
        req.headers as Record<string, string | string[] | undefined>,
      );
      const token = existing ?? crypto.randomUUID();

      await store.sessions.upsert(token);
      await store.sessions.touch(token);

      req.sessionToken = token;
      res.setHeader(SESSION_HEADER, token);
      res.cookie(SESSION_COOKIE, token, {
        maxAge: COOKIE_MAX_AGE_MS,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });

      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error("session middleware failed"));
    }
  };
}
