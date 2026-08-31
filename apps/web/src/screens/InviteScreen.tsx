import { useEffect, useState } from "react";
import type { GameId } from "@mpg/engine";
import { Button, Spinner, StatusBadge, Toast } from "../components/ui";
import type { PublicRoom } from "../api/roomTypes";
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

/** Resolves once `navigator.clipboard` succeeds; falls back to a legacy copy path. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      return true;
    } catch {
      return false;
    }
  }
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
  const [copied, setCopied] = useState(false);
  const title = GAME_CATALOG[gameId]?.title ?? gameId;

  useEffect(() => {
    if (room?.status === "active") onReady(room);
  }, [room, onReady]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async (): Promise<void> => {
    const ok = await copyToClipboard(inviteUrl);
    if (ok) setCopied(true);
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
          <Button variant="primary" onClick={handleCopy}>
            Copy link
          </Button>
        </div>
        {copied ? (
          <div className={styles.toastSlot}>
            <Toast variant="success" onDismiss={() => setCopied(false)} autoDismissMs={2000}>
              Link copied!
            </Toast>
          </div>
        ) : null}
      </div>
    </div>
  );
}
