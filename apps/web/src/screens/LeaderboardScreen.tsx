// MPG-055: leaderboard view — top entries for a game, the current player's
// row highlighted. Fetches `GET /api/leaderboard/:gameId` on mount.

import { useCallback, useEffect, useState } from "react";

import {
  BackArrowIcon,
  Button,
  HomeIcon,
  SkeletonGroup,
  Skeleton,
  StatusBadge,
  Toast,
} from "../components/ui";
import { fetchLeaderboard, type LeaderboardEntry } from "../api/leaderboard";
import { getSessionToken } from "../api/session";
import { getStoredUsername } from "../api/username";
import styles from "./LeaderboardScreen.module.css";

export interface LeaderboardScreenProps {
  /** Stable game id (e.g. "tictactoe", "connect4"), matches the room/session gameId. */
  gameId: string;
  /** Display name for the heading/caption, e.g. "Tic-Tac-Toe". */
  gameTitle: string;
  /** "wld" (default, turn-based win/loss/draw) or "score" (real-time). */
  metric?: "wld" | "score";
  onBack: () => void;
}

/**
 * Shortens an opaque session token to a readable, still-anonymous label —
 * used for the current player's own row when they haven't picked a username
 * (MPG-077), and always for everyone else's rows (we only know our own name
 * locally; other rows show the anonymized fallback).
 */
function playerLabel(ownerToken: string, isYou: boolean): string {
  if (isYou) return getStoredUsername() ?? "You";
  return `Player ${ownerToken.slice(0, 6)}`;
}

const SKELETON_ROWS = 5;

/**
 * Simple, accessible leaderboard table. Loading uses skeleton rows (never a
 * bare spinner — UX_PRINCIPLES §2); errors offer a retry; an empty board gets
 * an explanatory message rather than an empty table.
 */
export function LeaderboardScreen({
  gameId,
  gameTitle,
  metric = "wld",
  onBack,
}: LeaderboardScreenProps): React.JSX.Element {
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [yourRank, setYourRank] = useState<number | undefined>(undefined);

  const load = useCallback(() => {
    setStatus("loading");
    fetchLeaderboard(gameId, { metric })
      .then((res) => {
        setEntries(res.entries);
        setYourRank(res.yourRank);
        setStatus("ready");
      })
      .catch(() => {
        setStatus("error");
      });
  }, [gameId, metric]);

  useEffect(() => {
    load();
  }, [load]);

  const sessionToken = getSessionToken();
  const isScore = metric === "score";

  return (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Home">
          <span className={styles.homeIcons}>
            <BackArrowIcon />
            <HomeIcon />
          </span>
        </Button>
        <h1 className={styles.heading}>{gameTitle} Leaderboard</h1>
      </div>

      {status === "loading" ? (
        <SkeletonGroup label={`Loading ${gameTitle} leaderboard…`} className={styles.skeletonRows}>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <Skeleton key={i} variant="rect" height="2.5rem" />
          ))}
        </SkeletonGroup>
      ) : null}

      {status === "error" ? (
        <div className={styles.errorSlot}>
          <Toast variant="warning">Couldn't load the leaderboard.</Toast>
          <Button variant="secondary" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      ) : null}

      {status === "ready" && entries.length === 0 ? (
        <div className={styles.emptySlot}>
          <StatusBadge status="neutral">No games played yet</StatusBadge>
          <p className={styles.emptyText}>Be the first to play and claim the top spot.</p>
        </div>
      ) : null}

      {/* MPG-137: the rows are the one thing here that genuinely exceeds the
          frame, so they are the one thing that scrolls — inside it, with the
          top bar and Home pinned above (UX_PRINCIPLES §9). */}
      {status === "ready" && entries.length > 0 ? (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <caption className={styles.caption}>
              {gameTitle} — top {entries.length} {isScore ? "scores" : "players"}
              {yourRank !== undefined ? ` · your rank: #${yourRank}` : ""}
            </caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Player</th>
                <th scope="col">{isScore ? "Best score" : "Wins"}</th>
                <th scope="col">Games</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => {
                const rank = index + 1;
                const isYou = sessionToken !== null && entry.ownerToken === sessionToken;
                return (
                  <tr
                    key={entry.id}
                    className={isYou ? styles.selfRow : undefined}
                    aria-current={isYou ? "true" : undefined}
                  >
                    <td className={styles.numeric}>{rank}</td>
                    <td>{playerLabel(entry.ownerToken, isYou)}</td>
                    <td className={styles.numeric}>
                      {isScore ? (entry.bestScore ?? 0) : entry.wins}
                    </td>
                    <td className={styles.numeric}>{entry.totalGames}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
