// MPG-055: lightweight post-game leaderboard preview — shown alongside the
// Rematch action once a game ends. Fetches just the caller's own rank
// (`GET /api/leaderboard/:gameId/rank`), not the full board, to stay cheap.

import { useEffect, useState } from "react";

import { Button } from "../components/ui";
import { fetchYourRank } from "../api/leaderboard";
import styles from "./RankPreview.module.css";

export interface RankPreviewProps {
  gameId: string;
  metric?: "wld" | "score";
  onViewLeaderboard: () => void;
}

/**
 * Fetches and shows "Your rank: #N" after a game-over, with a link to the
 * full leaderboard. Fails silently (renders nothing) on error/no-session —
 * this is a nice-to-have preview, never a blocker on the result screen.
 */
export function RankPreview({
  gameId,
  metric = "wld",
  onViewLeaderboard,
}: RankPreviewProps): React.JSX.Element | null {
  const [rank, setRank] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchYourRank(gameId, { metric })
      .then((res) => {
        if (!cancelled) setRank(res.rank);
      })
      .catch(() => {
        if (!cancelled) setRank(null);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, metric]);

  if (rank === undefined) return null; // loading — no bare spinner, just skip the preview

  return (
    <div className={styles.wrap}>
      {rank !== null ? (
        <span className={styles.rank}>
          Leaderboard rank: <strong className={styles.rankValue}>#{rank}</strong>
        </span>
      ) : null}
      <Button variant="ghost" size="sm" onClick={onViewLeaderboard}>
        View full leaderboard
      </Button>
    </div>
  );
}
