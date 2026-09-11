/**
 * Durable share-link endpoints (MPG-056).
 *
 * These are NOT the ephemeral live-room invites of MPG-016 — those stay exactly
 * as they are. A share link here outlives every room: it is a row keyed by an
 * unguessable token that resolves to a finished result, its replay, or a
 * leaderboard view, long after the room that produced it is gone.
 *
 * Three rules shape the whole file:
 *
 *  1. **Capability-in-URL.** Holding the token IS the authorization to read —
 *     `GET /api/share/:token` deliberately requires no session. Anyone with the
 *     link can view; nobody can enumerate, because the token is 256 bits of
 *     randomness, not a guessable id.
 *  2. **Read-only.** A resolved link never exposes a way to write, and never
 *     leaks the owner's session token — that token is an identity credential,
 *     and a share link is handed to strangers by design.
 *  3. **Minting is owner-gated.** You may only mint a link to a result you own.
 *     Reading is public; publishing someone else's result is not.
 */

import { randomBytes } from "node:crypto";

import { Router } from "express";
import type { Request, Response } from "express";

import { emit, type EventSink } from "../analytics/sink.js";
import type { GameResult, ShareLink, Store } from "../store/ports.js";

/** What a token can point at. Mirrors the `kind` column's documented values. */
const SHARE_KINDS = ["result", "replay", "leaderboard"] as const;
type ShareKind = (typeof SHARE_KINDS)[number];

/**
 * 32 random bytes, base64url. Unguessable is the entire access-control story
 * for a capability URL, so this is deliberately far past "probably fine" —
 * and base64url keeps it copy-pasteable and safe in a path segment.
 */
function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

function isShareKind(value: unknown): value is ShareKind {
  return typeof value === "string" && (SHARE_KINDS as readonly string[]).includes(value);
}

/** Max lifetime a caller may request: 1 year. Expiry is optional (null = forever). */
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

function parseExpiry(raw: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return { ok: false };
  return { ok: true, value: new Date(Date.now() + Math.min(raw, MAX_EXPIRY_MS)) };
}

/**
 * The public, read-only projection of a finished result.
 *
 * An allowlist, not a redaction list: `ownerToken` (an identity credential) and
 * `moveLog` (only meaningful for a replay, and large) are absent because
 * nothing here copies them, rather than because something remembered to strip
 * them. A new column on `game_results` cannot silently start leaking.
 */
function toPublicResult(result: GameResult): Record<string, unknown> {
  return {
    gameId: result.gameId,
    gameFamily: result.gameFamily,
    status: result.status,
    score: result.score,
    winnerSlot: result.winnerSlot,
    seatsSnapshot: result.seatsSnapshot,
    durationMs: result.durationMs,
    createdAt: result.createdAt.toISOString(),
  };
}

function toPublicLink(link: ShareLink): Record<string, unknown> {
  return {
    token: link.token,
    kind: link.kind,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
  };
}

export function createShareRouter(store: Store, sink: EventSink): Router {
  const router = Router();

  // POST /api/share — mint a durable link to something this session owns.
  router.post("/share", async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const body = req.body as { kind?: unknown; targetId?: unknown; expiresInMs?: unknown };
    const kind = body?.kind;
    const targetId = body?.targetId;

    if (!isShareKind(kind) || typeof targetId !== "string" || targetId.length === 0) {
      res.status(400).json({ error: "INVALID_REQUEST" });
      return;
    }

    const expiry = parseExpiry(body?.expiresInMs);
    if (!expiry.ok) {
      res.status(400).json({ error: "INVALID_EXPIRY" });
      return;
    }

    // `result`/`replay` point at a row we can check ownership on. `leaderboard`
    // points at a game id — a public view that is nobody's property, so there
    // is nothing to own and nothing to check.
    let eventId: string | null = null;
    if (kind === "result" || kind === "replay") {
      const result = await store.results.findById(targetId);
      if (!result) {
        res.status(404).json({ error: "TARGET_NOT_FOUND" });
        return;
      }
      // Deliberately the same 404 as "no such result": a distinct 403 would let
      // a caller probe which result ids exist by watching the status change.
      if (result.ownerToken !== token) {
        res.status(404).json({ error: "TARGET_NOT_FOUND" });
        return;
      }
      eventId = result.eventId;
    }

    const link = await store.shareLinks.create({
      token: mintToken(),
      kind,
      targetId,
      ownerToken: token,
      eventId,
      expiresAt: expiry.value,
    });

    // Leg 4 numerator: the share rate is `share_minted / result_saved`.
    emit(sink, {
      name: "share_minted",
      ownerToken: token,
      shareLinkId: link.id,
      eventId,
      props: { kind },
    });

    res.status(201).json(toPublicLink(link));
  });

  // GET /api/share/:token — resolve a link. PUBLIC by design: the token is the
  // capability, so requiring a session here would break the whole point.
  router.get("/share/:token", async (req: Request, res: Response) => {
    const shareToken = req.params["token"] as string;
    const viewerToken = req.sessionToken;

    // `findByToken` already excludes revoked and expired links, so all three
    // failure modes (never existed / revoked / expired) land here as one 404.
    // That is intentional for privacy, and it is why the client's dead-link
    // screen speaks in terms of "this link no longer works" rather than
    // guessing which of the three happened.
    const link = await store.shareLinks.findByToken(shareToken);
    if (!link) {
      res.status(404).json({ error: "LINK_NOT_FOUND" });
      return;
    }

    // Leg 5 numerator: share CTR is `share_opened / share_minted`. Recorded
    // against the *viewer's* session, not the link owner's — counting the
    // sharer would make k-factor measure nothing but the sharer's own clicks.
    // `isOwner` keeps that distinction queryable instead of guessed: a creator
    // re-opening their own link is a real event, just not a viral one.
    emit(sink, {
      name: "share_opened",
      ownerToken: viewerToken,
      shareLinkId: link.id,
      eventId: link.eventId,
      props: { kind: link.kind, isOwner: link.ownerToken === viewerToken },
    });

    if (link.kind === "leaderboard") {
      res.json({ kind: link.kind, gameId: link.targetId, eventId: link.eventId });
      return;
    }

    const result = await store.results.findById(link.targetId);
    if (!result) {
      // The link outlived its target (retention swept the result). Same shape
      // as a dead link — from the viewer's side it is exactly that.
      res.status(404).json({ error: "LINK_NOT_FOUND" });
      return;
    }

    if (link.kind === "replay") {
      res.json({ kind: link.kind, result: { ...toPublicResult(result), moveLog: result.moveLog } });
      return;
    }

    res.json({ kind: link.kind, result: toPublicResult(result) });
  });

  // DELETE /api/share/:token — revoke. Owner-only; the repo enforces it.
  router.delete("/share/:token", async (req: Request, res: Response) => {
    const token = req.sessionToken;
    if (!token) {
      res.status(400).json({ error: "no_session" });
      return;
    }

    const revoked = await store.shareLinks.revoke(req.params["token"] as string, token);
    if (!revoked) {
      res.status(404).json({ error: "LINK_NOT_FOUND" });
      return;
    }

    res.status(204).end();
  });

  return router;
}
