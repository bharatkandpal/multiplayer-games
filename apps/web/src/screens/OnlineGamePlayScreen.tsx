// MPG-068: the online (room-backed) counterpart to `GamePlayScreen` — drives
// gameplay over the socket (`useOnlinePlay`) instead of a local engine
// (`useLocalPlayController`), and wires the result screen's Rematch button to
// the server-authoritative rematch flow (`useRematch`). Renders through the
// exact same `GamePlayScreenView` local play uses (board, seat row, turn
// badge, win/lose/draw treatment, live-region announcements) via a thin
// `PlayController` adapter — see `GamePlayScreen.tsx`'s doc comment on
// `PlayController` for why that adapter is safe to build by hand here.

import type { ReactNode } from "react";
import type { GameModule, Player } from "@mpg/engine";

import { Button, StatusBadge, Toast } from "../components/ui";
import type { SeatsConfig } from "../game";
import { useOnlinePlay } from "../hooks/useOnlinePlay";
import { useRematch } from "../hooks/useRematch";
import { useResultShareUrl } from "../hooks/useResultShare";
import type { PublicRoom, Slot } from "../api/roomTypes";
import { type BoardRenderProps, GamePlayScreenView, type PlayController } from "./GamePlayScreen";
import styles from "./OnlineGamePlayScreen.module.css";

export interface OnlineGamePlayScreenProps<S, M, L = unknown> {
  game: GameModule<S, M, L>;
  gameTitle: string;
  seats: SeatsConfig;
  renderBoard: (props: BoardRenderProps<S, M, L>) => ReactNode;
  describeMove: (move: M, player: Player) => string;
  roomId: string;
  yourSlot: Slot | undefined;
  sessionToken: string | undefined;
  /** The room snapshot already known when this screen mounts (from `useRoom()`). */
  initialRoom: PublicRoom | undefined;
  onExit: () => void;
  /** A mutual rematch was accepted — the caller navigates to the fresh room. */
  onRematchStart: (newRoomId: string) => void;
  /** MPG-055: shows a post-game rank preview on the result screen when provided. */
  onViewLeaderboard?: () => void;
}

/**
 * Online game screen (MPG-013/MPG-015/MPG-068): renders exactly like local
 * play, but every move — this client's own included — is only ever a request
 * to the server. `useOnlinePlay` applies this client's own move optimistically
 * for instant feedback, then reconciles to the server's broadcast (or rolls
 * back with a calm explanation on `move:rejected`); the opponent's moves only
 * ever arrive via that same reconcile path, never guessed locally.
 */
export function OnlineGamePlayScreen<S, M, L = unknown>({
  game,
  gameTitle,
  seats,
  renderBoard,
  describeMove,
  roomId,
  yourSlot,
  sessionToken,
  initialRoom,
  onExit,
  onRematchStart,
  onViewLeaderboard,
}: OnlineGamePlayScreenProps<S, M, L>): React.JSX.Element {
  const {
    session,
    yourTurn,
    makeMove,
    clearError,
    moveLog,
    phase,
    opponentDisconnected,
    roomAbandoned,
    roomAbandonReason,
    resultId,
  } = useOnlinePlay<S, M, L>({ game, roomId, yourSlot, initialRoom });

  // MPG-131: the server already persisted this seat's result (it refereed the
  // game), so unlike local play there is nothing to report — only a link to mint
  // against the id it pushed back over the socket.
  const shareUrl = useResultShareUrl(resultId);

  const { rematchProposed, opponentProposed, rematchAccepted, proposeRematch, declineRematch } =
    useRematch(roomId, sessionToken, yourSlot, onRematchStart);

  const controller: PlayController<S, M> = {
    session,
    seats,
    moveLog,
    isHumanTurn: yourTurn,
    thinkingSeat: null,
    isAllBots: false,
    watchSpeed: "1x",
    setWatchSpeed: () => {},
    isPaused: false,
    setPaused: () => {},
    canStep: false,
    step: () => {},
    play: makeMove,
    clearError,
    // Never called directly — the online `Rematch` button always goes through
    // `proposeRematch` below (see `online.proposeRematch` in GamePlayScreenView).
    rematch: () => {},
  };

  if (roomAbandoned) {
    return (
      <div className={styles.abandonedWrap}>
        <StatusBadge status="warning">
          {roomAbandonReason === "disconnect-timeout"
            ? "Your opponent didn't reconnect in time."
            : "Your opponent has left the game."}
        </StatusBadge>
        <Button variant="primary" onClick={onExit}>
          ← Back to home
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {opponentDisconnected ? (
        <div className={styles.banner}>
          <Toast variant="warning">Opponent disconnected — waiting for them to reconnect…</Toast>
        </div>
      ) : null}

      {phase === "waiting" ? (
        <div className={styles.waitingWrap}>
          <StatusBadge status="info">Connecting…</StatusBadge>
        </div>
      ) : (
        <GamePlayScreenView<S, M, L>
          gameTitle={gameTitle}
          seats={seats}
          renderBoard={renderBoard}
          describeMove={describeMove}
          onExit={onExit}
          controller={controller}
          gameId={game.id}
          {...(shareUrl ? { shareUrl } : {})}
          {...(onViewLeaderboard ? { onViewLeaderboard } : {})}
          online={{
            isRoomFinished: phase === "finished",
            rematchProposed,
            opponentProposed,
            rematchAccepted,
            proposeRematch,
            declineRematch,
          }}
        />
      )}
    </div>
  );
}
