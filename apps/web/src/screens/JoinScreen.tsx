import { useEffect, useRef } from "react";
import type { GameId } from "@mpg/engine";
import { Button, StatusBadge } from "../components/ui";
import { GAME_CATALOG } from "./HomeScreen";
import styles from "./JoinScreen.module.css";

export interface JoinScreenProps {
  gameId: GameId;
  roomId: string;
  /** The invite link's secret, parsed from the URL fragment — `undefined` for
   * a malformed/incomplete link (never a crash, just an immediate friendly
   * failure, same as any other join error). */
  secret: string | undefined;
  /** Starts joining `(roomId, secret)` as slot 2 (`useOnlineGame().joinRoom`). */
  joinRoom: (roomId: string, secret: string) => void;
  onJoined: () => void;
  onBackHome: () => void;
}

/**
 * Shown, briefly, when a player opens an invite link (`/:gameId/room/:roomId#s=...`,
 * MPG-012, reworked onto peer-to-peer Ably play): starts joining the room's
 * channel, then hands straight off to the game screen, which owns every
 * state from there (connecting / waiting for the peer / unavailable /
 * playing) — there's no separate server ack to wait on here. The one thing
 * this screen itself can fail on is the link being malformed (no secret in
 * the fragment), shown as a friendly message with a way back home rather
 * than a raw error (UX_PRINCIPLES).
 */
export function JoinScreen({
  gameId,
  roomId,
  secret,
  joinRoom,
  onJoined,
  onBackHome,
}: JoinScreenProps): React.JSX.Element {
  const attempted = useRef(false);
  const title = GAME_CATALOG[gameId]?.title ?? gameId;

  useEffect(() => {
    if (attempted.current || !secret) return;
    attempted.current = true;
    joinRoom(roomId, secret);
    onJoined();
    // Only run once per mount — `roomId`/`secret` identify this screen
    // instance. (`joinRoom`/`onJoined` are intentionally omitted from deps:
    // stable callbacks, and re-running this effect on every render would
    // re-join repeatedly.)
  }, [roomId, secret]);

  if (!secret) {
    return (
      <div className={styles.main}>
        <h1 className={styles.heading}>Joining {title}</h1>
        <div className={styles.errorBlock}>
          <StatusBadge status="danger">
            This invite link is missing its secret — ask for a fresh one.
          </StatusBadge>
          <Button variant="primary" onClick={onBackHome}>
            ← Back to home
          </Button>
        </div>
      </div>
    );
  }

  // The game screen takes over immediately (it owns "connecting" and every
  // state after) — this screen has nothing left to show once `onJoined` fires
  // in the same tick above.
  return <div className={styles.main} />;
}
