// MPG-025: the read-only, "watch bots play" counterpart to
// `OnlineGamePlayScreen` — an all-bot room has no human seat at all, so
// there's no turn-taking, no optimistic move, and no Rematch (nobody here
// has a seat to propose one from). Renders through the exact same
// `GamePlayScreenView` every other play surface uses (board, seat row, turn
// badge, win/lose/draw treatment, live-region announcements) via the same
// thin `PlayController` adapter pattern `OnlineGamePlayScreen` established.

import type { ReactNode } from "react";
import type { GameModule, Player } from "@mpg/engine";

import { StatusBadge } from "../components/ui";
import { useWatchOnlinePlay } from "../hooks/useWatchOnlinePlay";
import type { PublicRoom } from "../api/roomTypes";
import { type BoardRenderProps, GamePlayScreenView, type PlayController } from "./GamePlayScreen";
import styles from "./WatchGamePlayScreen.module.css";

export interface WatchGamePlayScreenProps<S, M, L = unknown> {
  game: GameModule<S, M, L>;
  gameTitle: string;
  renderBoard: (props: BoardRenderProps<S, M, L>) => ReactNode;
  describeMove: (move: M, player: Player) => string;
  roomId: string;
  /** MPG-025: this room's creator credential — lets this tab watch-rejoin the
   * room's broadcast channel after a reload (see `useWatchOnlinePlay`). */
  creatorToken: string | undefined;
  /** The room snapshot already known when this screen mounts (typically the
   * just-created room, from `room:create`'s ack). */
  initialRoom: PublicRoom | undefined;
  onExit: () => void;
}

/**
 * Watch-only game screen (MPG-025): renders exactly like online play, but
 * every move arrives purely from the server's broadcasts — there's no seat
 * here to move from, so the board is always non-interactive (same
 * `aria-disabled`-without-losing-focusability treatment every board renderer
 * already gives a bot's turn — nothing watch-specific needed there).
 */
export function WatchGamePlayScreen<S, M, L = unknown>({
  game,
  gameTitle,
  renderBoard,
  describeMove,
  roomId,
  creatorToken,
  initialRoom,
  onExit,
}: WatchGamePlayScreenProps<S, M, L>): React.JSX.Element {
  const { session, seats, phase } = useWatchOnlinePlay<S, M, L>({
    game,
    roomId,
    creatorToken,
    initialRoom,
  });

  // MPG-025: every seat here is a bot (by construction — see `isAllBotRoom`
  // at the call site), so whoever's turn it is reads as "thinking" the whole
  // time between moves — a lightweight, always-on version of the paced
  // "thinking…" indicator local all-bot watch already has, without needing
  // an explicit server "thinking" event (the server only ever tells us about
  // completed moves; pacing between them is what already makes them
  // followable — UX_PRINCIPLES §3).
  const controller: PlayController<S, M> = {
    session,
    seats,
    isHumanTurn: false,
    thinkingSeat: phase === "watching" ? session.turn : null,
    isAllBots: false, // hides the local watch-speed controls — the server already paces this.
    watchSpeed: "1x",
    setWatchSpeed: () => {},
    isPaused: false,
    setPaused: () => {},
    canStep: false,
    step: () => {},
    play: () => {}, // No seat to move from — the board is inherently read-only.
    clearError: () => {},
    rematch: () => {}, // Never called — `showRematch={false}` hides the button below.
  };

  if (phase === "connecting" || seats.length === 0) {
    return (
      <div className={styles.connectingWrap}>
        <StatusBadge status="info">Connecting to the game…</StatusBadge>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.watchNotice}>
        <StatusBadge status="neutral">👀 Watching — every seat is a bot</StatusBadge>
      </div>

      <GamePlayScreenView<S, M, L>
        gameTitle={gameTitle}
        seats={seats}
        renderBoard={renderBoard}
        describeMove={describeMove}
        onExit={onExit}
        controller={controller}
        showRematch={false}
      />
    </div>
  );
}
