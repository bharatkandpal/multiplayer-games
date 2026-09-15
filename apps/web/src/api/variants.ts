/**
 * Client-side "save a variant" API (MPG-089-c) — the client half of
 * `POST /api/variants` (MPG-089-b).
 *
 * Saving a variant is an **enhancement layered on the customize screen**,
 * never a gate on customizing or playing: picking cosmetics, playing with
 * them, and having them persist locally (`cosmetics/storage.ts`) all work with
 * no backend at all. This module is only what turns that local pick into an
 * owned, named, shareable thing — and it follows the same offline contract as
 * `api/identity.ts`: never throw on bad input, and any network failure /
 * backend-down resolves to a distinct "unavailable" outcome the caller uses to
 * simply not offer the affordance (degrade to absence, never an error banner).
 */

import { apiFetch } from "./session.js";
import type { CosmeticConfig } from "../cosmetics/types.js";
import type { ShareKind } from "./share.js";

/**
 * Client-side mirror of the server's `variant_name` moderation rules
 * (`moderation/moderate.ts`, kind `"variant_name"`): 1–40 characters, letters/
 * numbers/spaces and a small set of punctuation. Same contract as
 * `isValidHandleFormat` — instant, no-request feedback for the structural
 * half of validation. Profanity/impersonation remain the server's
 * authoritative call; a 400 from `saveVariant` surfaces its own reason.
 */
const VARIANT_NAME_MIN_LENGTH = 1;
const VARIANT_NAME_MAX_LENGTH = 40;
const VARIANT_NAME_PATTERN = /^[\p{L}\p{N} '!?.,:_-]+$/u;

export function isValidVariantNameFormat(name: string): boolean {
  return (
    name.length >= VARIANT_NAME_MIN_LENGTH &&
    name.length <= VARIANT_NAME_MAX_LENGTH &&
    VARIANT_NAME_PATTERN.test(name)
  );
}

/** The author's own view of their freshly-saved variant. */
export interface SavedVariant {
  readonly id: string;
  readonly name: string;
  readonly baseGameId: string;
  readonly cosmetics: CosmeticConfig;
  readonly forkedFrom: string | null;
  readonly createdAt: string;
}

/** The auto-minted durable link for the variant just saved (MPG-089-b). */
export interface VariantShareRef {
  readonly token: string;
  readonly kind: ShareKind;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

/**
 * The server's `variant_name` moderation reasons (`moderation/moderate.ts`).
 * `"OFFLINE"` is this client's own addition for the network-failure case —
 * never sent by the server.
 */
export type VariantNameReason =
  "EMPTY" | "TOO_SHORT" | "TOO_LONG" | "INVALID_CHARS" | "PROFANITY" | "RESERVED";

export type SaveVariantResult =
  | { readonly ok: true; readonly variant: SavedVariant; readonly share: VariantShareRef }
  /** The base game id didn't name a registered game. */
  | { readonly ok: false; readonly reason: "invalid_base_game" }
  /** The name failed moderation — `detail` is the server's own reason code. */
  | { readonly ok: false; readonly reason: "invalid_name"; readonly detail: VariantNameReason }
  /** The cosmetics map failed the shape/bounds guard — shouldn't happen for a
   *  client-generated config, but surfaced rather than assumed away. */
  | { readonly ok: false; readonly reason: "invalid_cosmetics"; readonly detail: string }
  /** No session, network failure, or the backend is simply down. */
  | { readonly ok: false; readonly reason: "unavailable" };

export interface SaveVariantInput {
  readonly baseGameId: string;
  readonly name: string;
  readonly cosmetics: CosmeticConfig;
}

/**
 * Saves a named, customized variant and returns the auto-minted share link
 * for it in the same response (the save request IS the "make it shareable"
 * moment — see the server route's doc comment). Never throws: every failure,
 * from a validation 400 to the backend being unreachable, is a `SaveVariantResult`
 * the caller can render inline. Callers that only ever want to offer this
 * affordance when the backend is known-reachable should gate on that
 * separately (mirroring `useClaimGate`'s boot probe) — this function itself
 * makes no assumption about whether the attempt will succeed.
 */
export async function saveVariant(input: SaveVariantInput): Promise<SaveVariantResult> {
  try {
    const res = await apiFetch("/api/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (res.ok) {
      const body = (await res.json()) as { variant: SavedVariant; share: VariantShareRef };
      return { ok: true, variant: body.variant, share: body.share };
    }

    if (res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
      };
      if (body.error === "INVALID_VARIANT_NAME") {
        return {
          ok: false,
          reason: "invalid_name",
          detail: (body.reason as VariantNameReason) ?? "INVALID_CHARS",
        };
      }
      if (body.error === "INVALID_VARIANT" && body.reason === "baseGameId") {
        return { ok: false, reason: "invalid_base_game" };
      }
      return { ok: false, reason: "invalid_cosmetics", detail: body.reason ?? "unknown" };
    }

    return { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
