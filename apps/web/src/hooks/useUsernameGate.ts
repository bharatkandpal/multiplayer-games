/**
 * Username gate (MPG-077) — decides when the first-run username picker needs
 * to show, and owns the small amount of state the picker needs.
 *
 * Local-first by design: `requireUsername` resolves synchronously if a name
 * is already cached, and `handleSubmit` proceeds the caller through
 * immediately on a valid local submit — it never waits on the network (see
 * `../api/username.ts`). It also listens for `onUsernameCollision`, which
 * fires only when a background sync (initial or reconciled) comes back with
 * a genuine, server-confirmed 409 — the one case where we ask again.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getStoredUsername,
  onUsernameCollision,
  setStoredUsername,
  syncUsername,
} from "../api/username.js";

export interface UseUsernameGateResult {
  /** Whether the picker modal should be shown. */
  isOpen: boolean;
  /** Set when the picker reopened because a background sync found a genuine collision. */
  collisionMessage: string | undefined;
  /**
   * Gate an online-only action behind having a username: calls `onReady`
   * immediately if one's already cached, otherwise opens the picker and
   * calls `onReady` the moment the user submits a valid name locally.
   */
  requireUsername: (onReady: () => void) => void;
  /** Wire to the picker's submit handler. */
  handleSubmit: (name: string) => void;
  /** Wire to the picker's cancel/close handler. */
  handleCancel: () => void;
}

const COLLISION_MESSAGE = "That name's taken — try another for this browser.";

export function useUsernameGate(onCancelled?: () => void): UseUsernameGateResult {
  const [isOpen, setIsOpen] = useState(false);
  const [collisionMessage, setCollisionMessage] = useState<string | undefined>(undefined);
  const pendingRef = useRef<(() => void) | undefined>(undefined);

  useEffect(
    () =>
      onUsernameCollision(() => {
        setCollisionMessage(COLLISION_MESSAGE);
        setIsOpen(true);
      }),
    [],
  );

  const requireUsername = useCallback((onReady: () => void) => {
    if (getStoredUsername()) {
      onReady();
      return;
    }
    pendingRef.current = onReady;
    setCollisionMessage(undefined);
    setIsOpen(true);
  }, []);

  const handleSubmit = useCallback((name: string) => {
    // Optimistic local write — the caller proceeds now, not after the network.
    setStoredUsername(name, false);
    setIsOpen(false);
    setCollisionMessage(undefined);

    const onReady = pendingRef.current;
    pendingRef.current = undefined;
    onReady?.();

    // Fire-and-forget: a genuine 409 reopens the picker via the collision
    // listener above; anything else is silent (see api/username.ts).
    void syncUsername(name);
  }, []);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    setCollisionMessage(undefined);
    pendingRef.current = undefined;
    onCancelled?.();
  }, [onCancelled]);

  return { isOpen, collisionMessage, requireUsername, handleSubmit, handleCancel };
}
