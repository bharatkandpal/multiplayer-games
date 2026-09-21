/**
 * The pure core of the unfurl shim (MPG-086 / ADR 0009).
 *
 * No I/O, no Node/DOM APIs — just: a resolved share record in, a set of
 * `<meta og:* / twitter:*>` tags out, and one function that injects them into the
 * SPA's own `index.html`. The Vercel function in `apps/web/api/unfurl.ts` is a
 * thin wrapper that does the fetching and the file reading; everything here is
 * unit-testable in isolation.
 *
 * Why head-only (not SSR): a social scraper reads six tags out of the initial
 * HTML and never runs the JS or looks at the body. We render exactly those tags
 * from a tiny data object and hand back the untouched shell for the human. See
 * ADR 0009 for the full rationale.
 */

import { gameTitle } from "./titles.js";

/**
 * The public share record as returned by `GET /api/share/:token`. Parsed from
 * untrusted network JSON, so every field is optional here and validated by
 * {@link parseShareRecord} before use — the shim never assumes a shape it got
 * over the wire.
 */
export interface ShareResult {
  readonly gameId?: unknown;
  readonly gameFamily?: unknown;
  readonly status?: unknown;
  readonly score?: unknown;
  readonly winnerSlot?: unknown;
  readonly seatsSnapshot?: unknown;
}

export type ShareRecord =
  | { readonly kind: "result" | "replay"; readonly result: ShareResult }
  | { readonly kind: "leaderboard"; readonly gameId: string };

/** The computed unfurl metadata for one share link. */
export interface UnfurlMeta {
  /** `og:title` / `twitter:title`, and the document `<title>`. */
  readonly title: string;
  /** `og:description` / `twitter:description`. */
  readonly description: string;
  /** Absolute `og:image` URL, or `undefined` when there is no card (leaderboard). */
  readonly imageUrl?: string;
  /** `og:image:alt` / `twitter:image:alt` — resolves the alt owing from MPG-085-b. */
  readonly imageAlt?: string;
  /** Canonical `og:url` for the share page. */
  readonly url: string;
}

/** Options the wrapper supplies from the request + environment. */
export interface UnfurlContext {
  /** The share token (opaque; used only to build asset URLs, never interpolated raw). */
  readonly token: string;
  /** Absolute URL of the share page itself, e.g. `https://host/s/<token>`. */
  readonly pageUrl: string;
  /** Absolute base of the API origin, e.g. `https://api.host` (no trailing slash). */
  readonly apiOrigin: string;
}

/**
 * Escapes a string for safe interpolation into a double-quoted HTML attribute.
 *
 * The security note in ADR 0009: injected tag *values* come from the resolved
 * record's known fields, but they are still data that ends up in HTML, so they
 * are escaped, not trusted. `"` and `&` are the ones that actually break out of a
 * `content="…"` attribute; `<`/`>` are escaped too for defence in depth.
 */
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Reads `seatsSnapshot` into an opponent phrase — a boundary-forced twin of the
 * server's `describeOpponents` (`apps/server/src/cards/genericCards.ts`). Returns
 * an empty string on any unreadable shape: a wrong opponent on something a player
 * is about to show friends is worse than one fewer line.
 */
function describeOpponents(snapshot: unknown): string {
  if (!Array.isArray(snapshot)) return "";
  let humans = 0;
  for (const item of snapshot) {
    if (typeof item !== "object" || item === null) return "";
    const kind = (item as Record<string, unknown>)["kind"];
    if (kind !== "human" && kind !== "bot") return "";
    if (kind === "human") humans += 1;
  }
  const seats = snapshot.length;
  if (seats < 2) return "";
  const bots = seats - humans;
  if (humans === 1 && bots >= 1) return bots === 1 ? "vs Bot" : `vs ${bots} bots`;
  if (bots === 0) return `${humans} players`;
  if (humans === 0) return "bots only";
  return `${humans} players, ${bots} bots`;
}

/** Whether a result is a realtime (scored) one — mirrors `cards/index.ts`. */
function isRealtime(result: ShareResult): boolean {
  return (
    result.gameFamily === "realtime" ||
    (result.gameFamily !== "turn-based" && typeof result.score === "number")
  );
}

/** The card's alt line, mirroring the `svgDocument(...)` titles in `genericCards.ts`. */
function resultHeadline(result: ShareResult): string {
  const title = gameTitle(typeof result.gameId === "string" ? result.gameId : "");
  if (isRealtime(result)) {
    const score = typeof result.score === "number" ? result.score : 0;
    return `${score.toLocaleString("en-US")} points on ${title}`;
  }
  const verdict =
    typeof result.winnerSlot === "number"
      ? `Player ${result.winnerSlot} won`
      : result.status === "in_progress"
        ? "Unfinished"
        : "Draw";
  return `${verdict} at ${title}`;
}

/** A short, honest call-to-action. No numbers baked in beyond the headline's. */
function resultDescription(result: ShareResult): string {
  const title = gameTitle(typeof result.gameId === "string" ? result.gameId : "");
  if (isRealtime(result)) return `Think you can beat it? Play ${title} free — no signup.`;
  const opponents = describeOpponents(result.seatsSnapshot);
  const where = opponents ? `${title} · ${opponents}` : title;
  return `${where}. Play free — no signup.`;
}

/**
 * Validates a parsed JSON body from `GET /api/share/:token` into a
 * {@link ShareRecord}, or returns `null` if it isn't a shape we can unfurl.
 *
 * `null` is not an error the caller surfaces — it is the degrade signal: an
 * unrecognised body means "serve the plain shell", exactly like a failed fetch.
 */
export function parseShareRecord(body: unknown): ShareRecord | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const kind = record["kind"];
  if (kind === "result" || kind === "replay") {
    const result = record["result"];
    if (typeof result !== "object" || result === null) return null;
    return { kind, result: result as ShareResult };
  }
  if (kind === "leaderboard") {
    const gameId = record["gameId"];
    if (typeof gameId !== "string") return null;
    return { kind, gameId };
  }
  return null;
}

/**
 * Builds the unfurl metadata for a resolved share record.
 *
 * `og:image` is the deterministic, immutably-cached card PNG
 * (`GET /api/cards/:token.png`) for a result/replay, and is omitted for a
 * leaderboard link — which has no card, matching `cardRoutes.ts`'s 404 for that
 * kind, so the scraper simply shows a card-less preview rather than a broken img.
 */
export function buildUnfurlMeta(record: ShareRecord, ctx: UnfurlContext): UnfurlMeta {
  if (record.kind === "leaderboard") {
    const title = gameTitle(record.gameId);
    return {
      title: `${title} leaderboard`,
      description: `See the top scores on ${title}. Play free — no signup.`,
      url: ctx.pageUrl,
    };
  }

  const headline = resultHeadline(record.result);
  return {
    title: headline,
    description: resultDescription(record.result),
    imageUrl: `${ctx.apiOrigin}/api/cards/${encodeURIComponent(ctx.token)}.png`,
    imageAlt: headline,
    url: ctx.pageUrl,
  };
}

/** One `<meta …>` line; both attributes escaped. `key` uses `property` for og:*. */
function metaTag(attr: "property" | "name", key: string, content: string): string {
  return `    <meta ${attr}="${escapeHtmlAttr(key)}" content="${escapeHtmlAttr(content)}" />`;
}

/**
 * Renders the full `<meta>` block for an {@link UnfurlMeta}. Open Graph uses
 * `property=`, Twitter uses `name=` — a scraper picks whichever family it reads.
 */
export function renderMetaTags(meta: UnfurlMeta): string {
  const tags: string[] = [
    metaTag("property", "og:type", "website"),
    metaTag("property", "og:title", meta.title),
    metaTag("property", "og:description", meta.description),
    metaTag("property", "og:url", meta.url),
    metaTag("name", "twitter:title", meta.title),
    metaTag("name", "twitter:description", meta.description),
  ];
  if (meta.imageUrl) {
    tags.push(
      metaTag("name", "twitter:card", "summary_large_image"),
      metaTag("property", "og:image", meta.imageUrl),
      metaTag("name", "twitter:image", meta.imageUrl),
    );
    if (meta.imageAlt) {
      tags.push(
        metaTag("property", "og:image:alt", meta.imageAlt),
        metaTag("name", "twitter:image:alt", meta.imageAlt),
      );
    }
  } else {
    tags.push(metaTag("name", "twitter:card", "summary"));
  }
  return tags.join("\n");
}

/**
 * Injects the meta block into the SPA shell's `<head>`, replacing the generic
 * `<title>` with the computed one.
 *
 * The shell is otherwise untouched — same hashed asset tags the Vite build
 * emitted — so the human who clicks the link boots the identical SPA and the
 * client router takes over at `/s/:token`. If the shell has no recognisable
 * `<head>`, the original HTML is returned verbatim: injection failure degrades to
 * the plain shell, never to a broken document.
 */
export function injectUnfurlMeta(html: string, meta: UnfurlMeta): string {
  const tags = renderMetaTags(meta);
  const titleTag = `<title>${escapeHtmlAttr(meta.title)}</title>`;

  // Swap the shell's generic <title> for the computed one, if present.
  const out = html.replace(/<title>[\s\S]*?<\/title>/i, titleTag);
  const hadTitle = out !== html;

  const headOpen = out.match(/<head[^>]*>/i);
  if (!headOpen) return out; // No <head> to inject into — return whatever we have.

  const insertAt = headOpen.index! + headOpen[0].length;
  const block = hadTitle ? `\n${tags}` : `\n${titleTag}\n${tags}`;
  return `${out.slice(0, insertAt)}${block}${out.slice(insertAt)}`;
}
