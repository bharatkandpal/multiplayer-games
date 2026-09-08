import { useEffect } from "react";
import type { GameId } from "@mpg/engine";
import { Button, Spinner, StatusBadge, Toast } from "../components/ui";
import type { PublicRoom } from "../api/roomTypes";
import { useShareLink } from "../hooks/useShareLink";
import { GAME_CATALOG } from "./HomeScreen";
import styles from "./InviteScreen.module.css";

export interface InviteScreenProps {
  gameId: GameId;
  room: PublicRoom | undefined;
  /** Full, shareable invite URL (origin + `/{gameId}/room/{roomId}`). */
  inviteUrl: string;
  /** Fires once the room fills and moves to `active` — the caller transitions to the board. */
  onReady: (room: PublicRoom) => void;
  onCancel: () => void;
}

/**
 * Shown to the room's creator while waiting for the invited opponent(s) to
 * join (MPG-012). Transitions automatically once every human seat is filled
 * (`room.status === "active"`).
 */
export function InviteScreen({
  gameId,
  room,
  inviteUrl,
  onReady,
  onCancel,
}: InviteScreenProps): React.JSX.Element {
  const title = GAME_CATALOG[gameId]?.title ?? gameId;
  const { share, status, canShare, reset } = useShareLink();

  useEffect(() => {
    if (room?.status === "active") onReady(room);
  }, [room, onReady]);

  const handleShare = (): void => {
    void share({
      url: inviteUrl,
      title: `Play ${title} with me`,
      text: `Join my ${title} game`,
    });
  };

  const filledCount = room?.seats.filter((s) => s.kind !== "human" || s.connected).length ?? 0;
  const totalCount = room?.seats.length ?? 0;

  return (
    <div className={styles.main}>
      <div className={styles.backRow}>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          ← Cancel
        </Button>
      </div>

      <h1 className={styles.heading}>Invite a friend to {title}</h1>

      <div className={styles.statusRow}>
        <StatusBadge status="info">Waiting for opponent…</StatusBadge>
        {totalCount > 0 ? (
          <span className={styles.seatCount}>
            {filledCount} / {totalCount} seats filled
          </span>
        ) : null}
      </div>

      <div className={styles.waitingBlock}>
        <Spinner />
      </div>

      <div className={styles.linkRow}>
        <label className={styles.linkLabel} htmlFor="invite-url">
          Share this link
        </label>
        <div className={styles.linkField}>
          <input
            id="invite-url"
            className={styles.linkInput}
            type="text"
            readOnly
            value={inviteUrl}
          />
          {/* One control, honestly labelled for whichever rung of the ladder
              this platform will actually reach (MPG-087). */}
          <Button variant="primary" onClick={handleShare}>
            {canShare ? "Share link" : "Copy link"}
          </Button>
        </div>
        {status === "copied" || status === "shared" ? (
          <div className={styles.toastSlot}>
            <Toast variant="success" onDismiss={reset} autoDismissMs={2000}>
              {status === "shared" ? "Link shared!" : "Link copied!"}
            </Toast>
          </div>
        ) : null}
        {status === "unavailable" ? (
          <div className={styles.toastSlot}>
            {/* Both automatic paths failed — the URL is already visible and
                selectable in the field above, so say so rather than leaving
                the press looking like it did nothing. */}
            <Toast variant="warning" onDismiss={reset}>
              Couldn&apos;t share automatically — copy the link above.
            </Toast>
          </div>
        ) : null}
      </div>
    </div>
  );
}
