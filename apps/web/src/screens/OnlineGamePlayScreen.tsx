// MPG-068 (reworked onto peer-to-peer Ably play): the online counterpart to
// `GamePlayScreen` — drives gameplay over `useOnlineGame` (mounted once in
// `App.tsx`, threaded down as the `online` prop) instead of a local engine
// (`useLocalPlayController`) or the old Socket.IO room. Renders through the
// exact same `GamePlayScreenView` local play uses (board, seat row, turn
// badge, win/lose/draw treatment, live-region announcements) via a thin
// `PlayController` adapter — see `GamePlayScreen.tsx`'s doc comment on
// `PlayController` for why that adapter is safe to build by hand here.
//
// No rematch here (out of scope for the peer-to-peer rework — there is no
// server to negotiate one over; `showRematch={false}` hides the whole
// affordance, same treatment the read-only watch screen used). A finished
// game still mints a share link: `useLocalResultShare` submits THIS browser's
// own move log exactly as local play does — each peer independently reports
// its own perspective of the same finished game, no server refereeing
// required (`POST /api/results` already replays/validates it).

import type { ReactNode } from "react";
import type { GameModule, Player } from "@mpg/engine";

import { Button, StatusBadge, Toast } from "../components/ui";
import type { SeatsConfig } from "../game";
import { useLocalResultShare } from "../hooks/useResultShare";
import type { UseOnlineGameResult } from "../hooks/useOnlineGame";
import { type BoardRenderProps, GamePlayScreenView, type PlayController } from "./GamePlayScreen";
import styles from "./OnlineGamePlayScreen.module.css";

export interface OnlineGamePlayScreenProps<S, M, L = unknown> {
  game: GameModule<S, M, L>;
  gameTitle: string;
  seats: SeatsConfig;
  renderBoard: (props: BoardRenderProps<S, M, L>) => ReactNode;
  describeMove: (move: M, player: Player) => string;
  /** The one shared `useOnlineGame()` instance, mounted in `App.tsx`. */
  online: UseOnlineGameResult;
  onExit: () => void;
  /** MPG-055: shows a post-game rank preview on the result screen when provided. */
  onViewLeaderboard?: () => void;
}

/**
 * Online game screen: renders exactly like local play, but every move — this
 * client's own included — is applied optimistically against the shared, pure
 * engine and published to the peer directly; the opponent's moves only ever
 * arrive validated the same way, never assumed (`useOnlineGame`'s
 * `apply_remote_move` boundary).
 */
export function OnlineGamePlayScreen<S, M, L = unknown>({
  game,
  gameTitle,
  seats,
  renderBoard,
  describeMove,
  online,
  onExit,
  onViewLeaderboard,
}: OnlineGamePlayScreenProps<S, M, L>): React.JSX.Element {
  const { phase, session, yourTurn, moveLog, opponentDisconnected, clearError, makeMove } = online;

  // MPG-131, adapted: nothing is server-persisted here, so this reports
  // exactly like a finished LOCAL game would (this browser's own move log) —
  // see the module doc comment above for why that's a faithful substitute.
  const shareUrl = useLocalResultShare<M>({
    gameId: game.id,
    seats,
    moveLog: (moveLog as unknown as PlayController<S, M>["moveLog"]) ?? [],
    isGameOver: phase === "finished",
  });

  if (phase === "unavailable") {
    return (
      <div className={styles.abandonedWrap}>
        <StatusBadge status="warning">Online play isn&apos;t available right now.</StatusBadge>
        <Button variant="primary" onClick={onExit}>
          ← Back to home
        </Button>
      </div>
    );
  }

  if (phase === "idle" || phase === "connecting" || phase === "waiting" || !session) {
    return (
      <div className={styles.waitingWrap}>
        <StatusBadge status="info">
          {phase === "waiting" ? "Waiting for your opponent…" : "Connecting…"}
        </StatusBadge>
      </div>
    );
  }

  const controller: PlayController<S, M> = {
    session: session as unknown as PlayController<S, M>["session"],
    seats,
    moveLog: moveLog as unknown as PlayController<S, M>["moveLog"],
    isHumanTurn: yourTurn,
    thinkingSeat: null,
    isAllBots: false,
    watchSpeed: "1x",
    setWatchSpeed: () => {},
    isPaused: false,
    setPaused: () => {},
    canStep: false,
    step: () => {},
    play: (move: M) => makeMove(move),
    clearError,
    // No rematch over peer-to-peer play (see module doc comment) —
    // `showRematch={false}` below hides the button that would call this.
    rematch: () => {},
  };

  return (
    <div className={styles.wrap}>
      {opponentDisconnected ? (
        <div className={styles.banner}>
          <Toast variant="warning">Opponent disconnected — waiting for them to reconnect…</Toast>
        </div>
      ) : null}

      <GamePlayScreenView<S, M, L>
        gameTitle={gameTitle}
        seats={seats}
        renderBoard={renderBoard}
        describeMove={describeMove}
        onExit={onExit}
        controller={controller}
        gameId={game.id}
        showRematch={false}
        {...(shareUrl ? { shareUrl } : {})}
        {...(onViewLeaderboard ? { onViewLeaderboard } : {})}
      />
    </div>
  );
}
