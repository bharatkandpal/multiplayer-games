import { useEffect, useState } from "react";
import { Button } from "./Button";
import { ShuffleIcon } from "./icons";
import { UsernamePrompt } from "./UsernamePrompt";
import { VisuallyHidden } from "./VisuallyHidden";
import {
  ensureUsername,
  onUsernameChange,
  rerollUsername,
  setStoredUsername,
  syncUsername,
} from "../../api/username.js";
import styles from "./UsernameBadge.module.css";

export interface UsernameBadgeProps {
  /** Optional extra class for placement by the host screen. */
  className?: string | undefined;
  /**
   * Collapse to a single, truncating line instead of wrapping. Home uses this so
   * the badge and its neighbouring Chat entry point share one row inside the
   * frame at 320px wide (MPG-137, `layout-frame.spec.ts`) rather than the badge
   * spilling onto a second line and pushing the page past the frame.
   */
  compact?: boolean;
}

/**
 * The Home identity chip: shows the player who they're playing as and lets them
 * re-roll a new fun default or type their own.
 *
 * A friendly `adjective+animal` name is auto-assigned at first visit (see
 * `ensureUsername`), so this is never empty and never a gate — it's an
 * always-satisfied piece of identity the player can enjoy or personalise. It
 * stays truthful across every path (re-roll, edit, a server-normalised name, a
 * silent regenerate after a collision) by subscribing to `onUsernameChange`
 * rather than tracking mutations itself.
 *
 * Fully offline-safe: the name is local-first; the shuffle and edit both write
 * locally and fire the uniqueness sync in the background. A genuine collision on
 * a name the player *typed* is surfaced by the app's existing username gate; a
 * collision on an auto/re-rolled name is resolved silently upstream, so this
 * control never dead-ends.
 */
export function UsernameBadge({ className, compact = false }: UsernameBadgeProps): React.JSX.Element {
  const [name, setName] = useState(ensureUsername);
  const [editing, setEditing] = useState(false);

  useEffect(() => onUsernameChange(setName), []);

  const rootClass = [styles.badge, compact ? styles.compact : "", className]
    .filter(Boolean)
    .join(" ");

  const handleEditSubmit = (next: string): void => {
    // Optimistic + local-first: store as a *chosen* name (auto = false), reflect
    // it immediately, and let the uniqueness sync run in the background. A 409 on
    // a chosen name reopens the app's username picker via the collision listener.
    setStoredUsername(next, false, false);
    setEditing(false);
    void syncUsername(next);
  };

  return (
    <div className={rootClass}>
      <span className={styles.label}>
        Playing as <span className={styles.name}>{name}</span>
      </span>
      <div className={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          className={styles.iconButton}
          onClick={() => setName(rerollUsername())}
        >
          <ShuffleIcon aria-hidden="true" />
          <VisuallyHidden>Shuffle to a new name</VisuallyHidden>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>

      <UsernamePrompt
        isOpen={editing}
        initialValue={name}
        title="Change your name"
        intro="This is how other players and the leaderboard will see you. Pick anything you like."
        onSubmit={handleEditSubmit}
        onCancel={() => setEditing(false)}
      />
    </div>
  );
}
