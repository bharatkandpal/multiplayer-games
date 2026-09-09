/**
 * Durable share links (MPG-056) — the client half of `/api/share`.
 *
 * Distinct from the ephemeral live-room invite (MPG-016): a link minted here
 * outlives every room and resolves to a finished result, its replay, or a
 * leaderboard view. The token in the URL IS the capability, so resolving one
 * deliberately does not need a session — anyone with the link can read it.
 */

import { apiFetch } from "./session";

export type ShareKind = "result" | "replay" | "leaderboard";

export interface ShareLinkRef {
  readonly token: string;
  readonly kind: ShareKind;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

/** The public projection of a result — no owner token, no move log. */
export interface SharedResult {
  readonly gameId: string;
  readonly gameFamily: string;
  readonly status: string;
  readonly score: number | null;
  readonly winnerSlot: number | null;
  readonly seatsSnapshot: unknown;
  readonly durationMs: number | null;
  readonly createdAt: string;
  /** Present only on a `replay` link. */
  readonly moveLog?: unknown;
}

export type SharedView =
  | { readonly kind: "result" | "replay"; readonly result: SharedResult }
  | { readonly kind: "leaderboard"; readonly gameId: string; readonly eventId: string | null };

/**
 * Thrown when a token resolves to nothing. The server answers "never existed",
 * "revoked", and "expired" with the same 404 on purpose (they'd otherwise be an
 * enumeration oracle), so the UI has exactly one dead-link state to render.
 */
export class DeadShareLinkError extends Error {
  constructor() {
    super("This link no longer works.");
    this.name = "DeadShareLinkError";
  }
}

export interface CreateShareLinkInput {
  readonly kind: ShareKind;
  readonly targetId: string;
  /** Optional lifetime. Omit for a link that never expires (the server caps it at a year). */
  readonly expiresInMs?: number;
}

/** Mints a durable link. Requires a session — you may only share what you own. */
export async function createShareLink(input: CreateShareLinkInput): Promise<ShareLinkRef> {
  const res = await apiFetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to create share link: ${res.status}`);
  }
  return (await res.json()) as ShareLinkRef;
}

/**
 * Resolves a shared token to its read-only view. Throws `DeadShareLinkError` on
 * a 404 so the landing screen can tell "this link is dead" (a designed state
 * with a way back into a game) apart from "the network failed" (retryable).
 */
export async function fetchSharedView(token: string): Promise<SharedView> {
  const res = await apiFetch(`/api/share/${encodeURIComponent(token)}`);
  if (res.status === 404) {
    throw new DeadShareLinkError();
  }
  if (!res.ok) {
    throw new Error(`Failed to resolve share link: ${res.status}`);
  }
  return (await res.json()) as SharedView;
}

/** Revokes a link. Owner-only; a non-owner gets the same 404 as a missing link. */
export async function revokeShareLink(token: string): Promise<boolean> {
  const res = await apiFetch(`/api/share/${encodeURIComponent(token)}`, { method: "DELETE" });
  return res.status === 204;
}

/** The canonical in-app URL for a shared token. */
export function shareUrlForToken(token: string): string {
  const path = `/s/${token}`;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}
