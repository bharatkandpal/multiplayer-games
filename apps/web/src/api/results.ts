/**
 * Client-reported turn-based results (MPG-131) — the client half of
 * `POST /api/results`.
 *
 * Only local play needs this. A room-backed game is already persisted by the
 * server that refereed it, and hands the client its `resultId` over the socket
 * (`game:result-saved`); local play never touches a room, so a finished game has
 * to be reported for it to become shareable at all.
 *
 * The server does not take the outcome on trust: it replays `moveLog` through the
 * same shared `GameModule` and derives the status/winner itself. That is why this
 * sends the move log rather than a tidy `{ winner }` — the log is the evidence.
 */

import { apiFetch } from "./session";

/** One move as replayed by the server: who played it (1-based slot) + the move. */
export interface SubmittedMove {
  readonly slot: number;
  readonly move: unknown;
}

/** A seat as it stood when the game ended — display metadata for the share view. */
export interface SubmittedSeat {
  readonly slot: number;
  readonly kind: "human" | "bot";
  readonly difficulty?: string;
}

export interface TurnBasedResultSubmission {
  /** Client-minted idempotency key — a retry with the same id can't double-write. */
  readonly runId: string;
  readonly moveLog: readonly SubmittedMove[];
  readonly seatsSnapshot: readonly SubmittedSeat[];
  readonly durationMs?: number;
}

export interface SubmitResultResponse {
  readonly ok: true;
  /** Present when this `runId` was already persisted — the write was a no-op. */
  readonly duplicate?: boolean;
  readonly resultId: string;
}

/**
 * Persists a finished local turn-based game and returns its result id.
 *
 * Throws on any non-2xx (including a 422 `REPLAY_MISMATCH`) so callers can decide
 * how loud to be. Every call site today treats failure as silent and non-fatal:
 * the game is over and won, and losing the ability to share it is not worth an
 * error banner over a finished game.
 */
export async function submitTurnBasedResult(
  gameId: string,
  submission: TurnBasedResultSubmission,
): Promise<SubmitResultResponse> {
  const res = await apiFetch("/api/results", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId, ...submission }),
  });
  if (!res.ok) {
    throw new Error(`Failed to submit result: ${res.status}`);
  }
  return (await res.json()) as SubmitResultResponse;
}
