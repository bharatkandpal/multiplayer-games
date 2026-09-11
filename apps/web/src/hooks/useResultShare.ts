/**
 * Turning a finished turn-based game into a shareable `/s/:token` URL (MPG-131).
 *
 * Two hooks because the two turn-based modes learn their result id in genuinely
 * different ways, and pretending otherwise would mean one hook with a mode flag
 * and two dead branches:
 *
 *  • **Local play** — nothing is persisted yet. `useLocalResultShare` reports the
 *    finished game to `POST /api/results` (which replays the move log to validate
 *    it), then mints against the id that comes back.
 *  • **Online play** — the server already persisted the result when it refereed
 *    the game, and pushes each seat its own id over `game:result-saved`.
 *    `useResultShareUrl` just mints against that.
 *
 * Both are silent on failure by design. The game is over; a share link that
 * couldn't be minted costs the player the share button, not the result, and an
 * error banner over a finished game would be noise about something they never
 * asked for. Callers fall back to a plain game URL.
 */

import { useEffect, useRef, useState } from "react";

import { submitTurnBasedResult, type SubmittedMove, type SubmittedSeat } from "../api/results";
import { mintResultShareUrl } from "../api/share";
import type { AppliedMove } from "../game/gameSession";
import type { SeatsConfig } from "../game/seatConfig";

/**
 * Mints a durable share URL for an already-persisted result.
 *
 * Minting starts the moment `resultId` arrives rather than on the share tap —
 * see `mintResultShareUrl` for why that ordering matters to the native share
 * sheet. Returns `undefined` until (and if) a link exists.
 */
export function useResultShareUrl(resultId: string | undefined): string | undefined {
  const [shareUrl, setShareUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!resultId) {
      // A new game started (or the id was cleared) — drop the old link rather
      // than leaving it to be shared under the next game's outcome.
      setShareUrl(undefined);
      return;
    }
    let cancelled = false;
    void mintResultShareUrl(resultId).then((url) => {
      if (!cancelled) setShareUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [resultId]);

  return shareUrl;
}

export interface UseLocalResultShareOptions<M> {
  readonly gameId: string;
  readonly seats: SeatsConfig;
  /** Every move applied this game, oldest first (`LocalPlayController.moveLog`). */
  readonly moveLog: readonly AppliedMove<M>[];
  /** True once the local session reached a terminal position. */
  readonly isGameOver: boolean;
  /**
   * Set false to skip reporting entirely. Used for all-bot "watch" sessions,
   * where nobody played and there is no brag to share.
   */
  readonly enabled?: boolean;
}

/**
 * A client-minted id for one finished game. The submit route no-ops on a `runId`
 * it has already persisted, so a retry after a network blip can never double-write
 * — which is why the id is minted per game here rather than server-side.
 */
function makeRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `game-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** `AppliedMove`'s 1-based `player` IS the seat slot — the engine and the room model agree. */
function toSubmittedMoves<M>(moveLog: readonly AppliedMove<M>[]): SubmittedMove[] {
  return moveLog.map((entry) => ({ slot: entry.player, move: entry.move }));
}

function toSubmittedSeats(seats: SeatsConfig): SubmittedSeat[] {
  return seats.map((seat, index) => ({
    slot: index + 1,
    kind: seat.kind,
    ...(seat.kind === "bot" ? { difficulty: seat.difficulty } : {}),
  }));
}

/**
 * Reports a finished LOCAL turn-based game and mints its share link.
 *
 * Submits exactly once per finished game: the guard is released when the session
 * leaves the terminal state (a rematch resets the board), so the next game gets
 * its own submission and its own link, and a re-render never re-posts the same
 * one. A game with no moves is skipped — there is nothing to replay, and nothing
 * happened worth sharing.
 */
export function useLocalResultShare<M>({
  gameId,
  seats,
  moveLog,
  isGameOver,
  enabled = true,
}: UseLocalResultShareOptions<M>): string | undefined {
  const [resultId, setResultId] = useState<string | undefined>(undefined);
  const submittedRef = useRef(false);

  // Read through refs: the effect must fire on the game-over EDGE only, and
  // depending on `moveLog`/`seats` would re-run it as those settle.
  const moveLogRef = useRef(moveLog);
  moveLogRef.current = moveLog;
  const seatsRef = useRef(seats);
  seatsRef.current = seats;

  useEffect(() => {
    if (!isGameOver) {
      // Back to a live board (rematch / new opponent) — arm for the next result
      // and drop the finished one so its link can't be shared under a new game.
      submittedRef.current = false;
      setResultId(undefined);
      return;
    }
    if (!enabled || submittedRef.current) return;
    const log = moveLogRef.current;
    if (log.length === 0) return;
    submittedRef.current = true;

    let cancelled = false;
    void submitTurnBasedResult(gameId, {
      runId: makeRunId(),
      moveLog: toSubmittedMoves(log),
      seatsSnapshot: toSubmittedSeats(seatsRef.current),
    })
      .then((res) => {
        if (!cancelled) setResultId(res.resultId);
      })
      .catch((error: unknown) => {
        console.warn("[results] could not persist the finished game", error);
      });
    return () => {
      cancelled = true;
    };
  }, [isGameOver, enabled, gameId]);

  return useResultShareUrl(resultId);
}
