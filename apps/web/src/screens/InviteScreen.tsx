import { useEffect } from "react";
import type { GameId } from "@mpg/engine";
import { Button, Spinner, StatusBadge, Toast } from "../components/ui";
import { useShareLink } from "../hooks/useShareLink";
import { GAME_CATALOG } from "./HomeScreen";
import styles from "./InviteScreen.module.css";

export interface InviteScreenProps {
  gameId: GameId;
  /** Full, shareable invite URL (origin + `/{gameId}/room/{roomId}` + the secret fragment). */
  inviteUrl: string;
  /**
   * Whether the peer's presence has been seen on the room's Ably channel yet
   * (`useOnlineGame`'s `peerConnected`) — this screen's only signal that the
   * link was opened, since there's no server room to poll a `status` from.
   */
  peerConnected: boolean;
  /** True if the token mint/Ably connection failed outright — online play isn't available right now. */
  unavailable: boolean;
  /** Fires once the peer has joined — the caller transitions to the board. */
  onReady: () => void;
  onCancel: () => void;
}

/**
 * Shown to the room's creator while waiting for the invited opponent to open
 * the link (MPG-012, reworked onto peer-to-peer Ably play). Transitions
 * automatically once the peer's presence is seen on the channel.
 */
export function InviteScreen({
  gameId,
  inviteUrl,
  peerConnected,
  unavailable,
  onReady,
  onCancel,
}: InviteScreenProps): React.JSX.Element {
  const title = GAME_CATALOG[gameId]?.title ?? gameId;
  const { share, status, canShare, reset } = useShareLink();

  useEffect(() => {
    if (peerConnected) onReady();
  }, [peerConnected, onReady]);

  const handleShare = (): void => {
    void share({
      url: inviteUrl,
      title: `Play ${title} with me`,
      text: `Join my ${title} game`,
    });
  };

  if (unavailable) {
    return (
      <div className={styles.main}>
        <h1 className={styles.heading}>Invite a friend to {title}</h1>
        <StatusBadge status="warning">Online play isn&apos;t available right now.</StatusBadge>
        <p className={styles.seatCount}>
          You can still play {title} against the bot, or a friend on this device.
        </p>
        <Button variant="primary" onClick={onCancel}>
          ← Back
        </Button>
      </div>
    );
  }

  const filledCount = peerConnected ? 2 : 1;
  const totalCount = 2;

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
