// MPG-056: the landing screen for a durable share link (`/s/:token`).
//
// This is the first thing a stranger sees — someone who arrived from a friend's
// message with no session, no context, and no reason to stay. So the screen's
// job is not only to render a result: every state has to end in a way INTO a
// game, including the dead-link state. A share link that dead-ends is a broken
// viral loop, which is exactly what this task exists to fix.

import { useCallback, useEffect, useState } from "react";

import { Button, Skeleton, SkeletonGroup, StatusBadge, Toast } from "../components/ui";
import { DeadShareLinkError, fetchSharedView, type SharedView } from "../api/share";
import { GAME_CATALOG, REALTIME_CATALOG } from "./catalog";
import type { GameId, RealtimeGameId } from "@mpg/engine";
import styles from "./SharedResultScreen.module.css";

export interface SharedResultScreenProps {
  token: string;
  /**
   * Start the game this result came from — the "way in" for a brand-new visitor.
   * When `challengeScore` is given (a scored, real-time result opened via "Beat
   * this score"), the game opens with that score as a target to beat (MPG-087).
   */
  onPlayGame: (gameId: string, challengeScore?: number) => void;
  onBackHome: () => void;
  /** Open the full leaderboard for a game (used by a `leaderboard` link). */
  onViewLeaderboard: (gameId: string) => void;
}

type Status = "loading" | "ready" | "dead" | "error";

/** Title for either game family, falling back to the raw id for an unknown game. */
function gameTitle(gameId: string): string {
  return (
    GAME_CATALOG[gameId as GameId]?.title ??
    REALTIME_CATALOG[gameId as RealtimeGameId]?.title ??
    gameId
  );
}

/**
 * The headline for a shared result. Real-time runs brag with a score; turn-based
 * results have no score, so they state the outcome instead. Deliberately
 * outcome-first and short — this is the line that gets screenshotted.
 */
function headline(view: Extract<SharedView, { kind: "result" | "replay" }>): string {
  const { result } = view;
  if (result.score !== null) return `Scored ${result.score}`;
  // `winnerSlot` is a 1-based seat slot — the same index the engine calls
  // `Player`, and what both result writers persist (`rooms/moveHandler.ts`,
  // `results/resultRoutes.ts`). It is already the number a player reads on the
  // board, so incrementing it would name the wrong seat.
  if (result.winnerSlot !== null) return `Player ${result.winnerSlot} won`;
  // A finished game with neither a score nor a winner is a draw. The two
  // families spell "finished" differently — turn-based rows carry the engine's
  // own "win"/"draw", real-time rows carry "complete" — so this checks for the
  // one status that ISN'T terminal rather than enumerating those that are.
  if (result.status === "in_progress") return "Unfinished game";
  return "Ended in a draw";
}

export function SharedResultScreen({
  token,
  onPlayGame,
  onBackHome,
  onViewLeaderboard,
}: SharedResultScreenProps): React.JSX.Element {
  const [status, setStatus] = useState<Status>("loading");
  const [view, setView] = useState<SharedView | undefined>(undefined);

  const load = useCallback(() => {
    setStatus("loading");
    let cancelled = false;
    fetchSharedView(token)
      .then((resolved) => {
        if (cancelled) return;
        setView(resolved);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A dead link is a designed destination, not a failure: it gets its own
        // copy and its own way forward, and offering "Try again" for it would
        // be a lie — retrying a revoked link never works.
        setStatus(error instanceof DeadShareLinkError ? "dead" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => load(), [load]);

  return (
    <div className={styles.main}>
      {status === "loading" ? (
        <SkeletonGroup label="Loading shared result…" className={styles.skeletons}>
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="rect" height="6rem" />
          <Skeleton variant="text" width="40%" />
        </SkeletonGroup>
      ) : null}

      {status === "error" ? (
        <div className={styles.slot}>
          <Toast variant="warning">Couldn't load this shared result.</Toast>
          <div className={styles.actions}>
            <Button variant="primary" onClick={load}>
              Try again
            </Button>
            <Button variant="ghost" onClick={onBackHome}>
              Back to games
            </Button>
          </div>
        </div>
      ) : null}

      {status === "dead" ? (
        <div className={styles.slot}>
          <StatusBadge status="neutral">Link no longer works</StatusBadge>
          <p className={styles.deadText}>
            This link may have expired or been removed by whoever shared it. The games are all still
            here, though.
          </p>
          {/* The whole point of this screen: even a dead link ends in a game. */}
          <Button variant="primary" onClick={onBackHome}>
            Browse games
          </Button>
        </div>
      ) : null}

      {status === "ready" && view?.kind === "leaderboard" ? (
        <div className={styles.slot}>
          <p className={styles.eyebrow}>Shared leaderboard</p>
          <h1 className={styles.headline}>{gameTitle(view.gameId)}</h1>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => onViewLeaderboard(view.gameId)}>
              View leaderboard
            </Button>
            <Button variant="secondary" onClick={() => onPlayGame(view.gameId)}>
              Play {gameTitle(view.gameId)}
            </Button>
          </div>
        </div>
      ) : null}

      {status === "ready" && (view?.kind === "result" || view?.kind === "replay") ? (
        <div className={styles.slot}>
          <p className={styles.eyebrow}>{gameTitle(view.result.gameId)}</p>
          <h1 className={styles.headline}>{headline(view)}</h1>
          <p className={styles.meta}>
            <time dateTime={view.result.createdAt}>
              {new Date(view.result.createdAt).toLocaleDateString()}
            </time>
          </p>
          {/* Primary action is to PLAY, not to admire someone else's score —
              the shared link exists to pull a new player into the loop. For a
              scored (real-time) result that becomes a direct challenge: "Beat
              this score" drops the visitor into the game with this score as the
              target (MPG-087). Turn-based results have no score, so they keep the
              plain "Play" — there's nothing to beat, only to play. */}
          <div className={styles.actions}>
            {view.result.score !== null ? (
              <Button
                variant="primary"
                onClick={() => onPlayGame(view.result.gameId, view.result.score ?? undefined)}
              >
                Beat this score
              </Button>
            ) : (
              <Button variant="primary" onClick={() => onPlayGame(view.result.gameId)}>
                Play {gameTitle(view.result.gameId)}
              </Button>
            )}
            <Button variant="ghost" onClick={() => onViewLeaderboard(view.result.gameId)}>
              View leaderboard
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
