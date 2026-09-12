/**
 * The unfurl shim (MPG-086 / ADR 0009) — the frontend host's head-only injector.
 *
 * A social scraper hitting a share link (`/s/:token`) needs real
 * `<meta og:* / twitter:*>` in the *initial* HTML, because it never runs the JS.
 * `vercel.json` rewrites `/s/:token` here; this function:
 *
 *   1. fetches the SPA's own `index.html` (the shell the Vite build emitted, with
 *      the correct hashed asset tags) from this same origin;
 *   2. resolves the token via the backend's already-public `GET /api/share/:token`;
 *   3. injects the computed `<meta>` into that shell's `<head>` and returns it.
 *
 * **Degradation is the default branch, not an add-on** (ADR 0009 / the offline
 * pillar). A missing token, an unset API origin, a failed/timed-out/404 resolve,
 * an unparseable body, or a bad shell — every one of them serves the *untouched*
 * shell. The human always boots the identical SPA; the scraper just gets a plain
 * unfurl. Nothing here 5xxs and nothing blocks the human's path into the app.
 *
 * All share/data logic stays on the backend: this reads only the existing public
 * API and points `og:image` at the existing card endpoint. Nothing crosses the
 * one-way import boundary (it never imports `@mpg/server`).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

import { buildUnfurlMeta, injectUnfurlMeta, parseShareRecord } from "../src/unfurl/meta";

/** Max ms we'll wait on the backend resolve before degrading to the plain shell. */
const RESOLVE_TIMEOUT_MS = 2500;

/**
 * Share tokens are 32 random bytes, base64url (`share/shareRoutes.ts`). We accept
 * only that alphabet and a sane length before ever calling the backend — a cheap
 * guard so a junk path can't drive a resolve request, and belt-and-braces on top
 * of the escaping (the token is never interpolated into HTML, only into URLs).
 */
function isPlausibleToken(token: string): boolean {
  return token.length > 0 && token.length <= 256 && /^[A-Za-z0-9_-]+$/.test(token);
}

/** The API origin to resolve against, or `""` if none is configured (→ degrade). */
function apiOrigin(): string {
  const raw =
    process.env["UNFURL_API_ORIGIN"] ??
    process.env["API_ORIGIN"] ??
    process.env["VITE_API_URL"] ??
    "";
  return raw.replace(/\/+$/, "");
}

/** The absolute origin this request arrived on, for fetching our own shell. */
function selfOrigin(req: VercelRequest): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host ?? "";
  return `${proto}://${host}`;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the untouched SPA shell from this same deployment. */
async function fetchShell(origin: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${origin}/index.html`, RESOLVE_TIMEOUT_MS);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Resolves the token to a share record, or `null` on any failure (→ degrade). */
async function resolveShare(origin: string, token: string): Promise<unknown | null> {
  if (!origin) return null;
  try {
    const res = await fetchWithTimeout(
      `${origin}/api/share/${encodeURIComponent(token)}`,
      RESOLVE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const rawToken = req.query["token"];
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  const origin = selfOrigin(req);
  const shell = await fetchShell(origin);

  // Short shared-cache TTL: the shell is stable but a share link is revocable, so
  // a revoked link must stop unfurling within minutes rather than being pinned.
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");

  // No shell to serve — a bare, valid HTML document is still better than a 5xx.
  if (!shell) {
    res.status(200).send("<!doctype html><html><head></head><body></body></html>");
    return;
  }

  if (typeof token !== "string" || !isPlausibleToken(token)) {
    res.status(200).send(shell); // No usable token → plain shell.
    return;
  }

  const body = await resolveShare(apiOrigin(), token);
  const record = parseShareRecord(body);
  if (!record) {
    res.status(200).send(shell); // Unresolvable / unrecognised → plain shell.
    return;
  }

  const meta = buildUnfurlMeta(record, {
    token,
    pageUrl: `${origin}/s/${token}`,
    apiOrigin: apiOrigin(),
  });
  res.status(200).send(injectUnfurlMeta(shell, meta));
}
