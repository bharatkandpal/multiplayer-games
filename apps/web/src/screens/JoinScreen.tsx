import { useEffect, useRef, useState } from "react";
import type { GameId } from "@mpg/engine";
import { Button, Spinner, StatusBadge } from "../components/ui";
import type { PublicRoom, RoomErrorPayload } from "../api/roomTypes";
import { GAME_CATALOG } from "./HomeScreen";
import styles from "./JoinScreen.module.css";

export interface JoinScreenProps {
  gameId: GameId;
  roomId: string;
  /** Emits `room:join` for `roomId`; resolves with the room on success. */
  joinRoom: (roomId: string) => Promise<PublicRoom | undefined>;
  /** Set once a `room:join` (or the resulting `room:error`) fails. */
  error: RoomErrorPayload | undefined;
  onJoined: (room: PublicRoom) => void;
  onBackHome: () => void;
}

const FRIENDLY_ERROR: Record<string, string> = {
  NOT_FOUND: "This invite link has expired or the room no longer exists.",
  EXPIRED: "This invite link has expired.",
  ROOM_FULL: "This room is already full.",
  SEAT_TAKEN: "That seat has already been taken.",
  SEAT_NOT_FOUND: "That seat doesn't exist in this room.",
};

function friendlyMessage(error: RoomErrorPayload): string {
  return FRIENDLY_ERROR[error.code] ?? error.message ?? "Couldn't join this room.";
}

/**
 * Shown when a player opens an invite link (`/:gameId/room/:roomId`, MPG-012):
 * joins the room over the socket, then hands off to the game once seated.
 * On failure (room full/expired/not found), shows a friendly message with a
 * way back home rather than a raw error code (UX_PRINCIPLES).
 */
export function JoinScreen({
  gameId,
  roomId,
  joinRoom,
  error,
  onJoined,
  onBackHome,
}: JoinScreenProps): React.JSX.Element {
  const [status, setStatus] = useState<"joining" | "joined" | "failed">("joining");
  const attempted = useRef(false);
  const title = GAME_CATALOG[gameId]?.title ?? gameId;

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void joinRoom(roomId).then((room) => {
      if (room) {
        setStatus("joined");
        onJoined(room);
      } else {
        setStatus("failed");
      }
    });
    // Only run once per mount — `roomId` identifies this screen instance.
    // (`joinRoom` is intentionally omitted from deps: it's a stable callback
    // from `useRoom`, and re-running this effect on every render would
    // re-join repeatedly.)
  }, [roomId]);

  useEffect(() => {
    if (error) setStatus("failed");
  }, [error]);

  return (
    <div className={styles.main}>
      <h1 className={styles.heading}>Joining {title}</h1>

      {status === "joining" ? (
        <div className={styles.joiningBlock}>
          <Spinner />
          <StatusBadge status="info">Joining room…</StatusBadge>
        </div>
      ) : null}

      {status === "failed" ? (
        <div className={styles.errorBlock}>
          <StatusBadge status="danger">
            {error ? friendlyMessage(error) : "Couldn't join this room."}
          </StatusBadge>
          <Button variant="primary" onClick={onBackHome}>
            ← Back to home
          </Button>
        </div>
      ) : null}
    </div>
  );
}
