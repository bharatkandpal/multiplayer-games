import { useCallback, useEffect, useRef, useState } from "react";
import { type GameRules, rulesFor } from "../screens/rules";

/**
 * Namespaced per game: "I know how to play Nim" says nothing about Breakout,
 * and one shared flag would mean the second game a player ever opens is the
 * first one they get no help with.
 */
export function rulesSeenStorageKey(gameId: string): string {
  return `mpg:rules-seen:${gameId}`;
}

/**
 * Best-effort, exactly like every other client-side preference here: private
 * browsing, disabled storage and SSR all land on "not seen yet". Showing the
 * rules to someone who has already read them is a mild annoyance; failing to
 * render a game because a storage read threw is not a trade worth making.
 */
function hasSeenRules(gameId: string): boolean {
  try {
    return window.localStorage.getItem(rulesSeenStorageKey(gameId)) !== null;
  } catch {
    return false;
  }
}

function markRulesSeen(gameId: string): void {
  try {
    window.localStorage.setItem(rulesSeenStorageKey(gameId), "1");
  } catch {
    // Swallowed — the sheet just opens again next time, which is survivable.
  }
}

export interface GameRulesState {
  /** The prose to render, or `null` when this game has no rules written. */
  rules: GameRules | null;
  isOpen: boolean;
  /** Opens the sheet from the Rules control. */
  open: () => void;
  close: () => void;
}

/**
 * MPG-138: owns whether the how-to-play sheet is showing, and opens it by
 * itself the first time a player lands on a given game.
 *
 * Two things have to be true at once — rules are reachable *whenever* a player
 * wants them, and they arrive unasked at the one moment they're definitely
 * needed. Auto-open is therefore once per game per device and never again:
 * a prompt that keeps reappearing after you've learnt the game is a nag, and a
 * player who wants a refresher has the Rules control.
 *
 * Entirely local (localStorage, no network) — per the offline rule, knowing how
 * to play must not depend on a service being up. That also means "seen" doesn't
 * follow a player across devices, which is the right side to fail on: showing
 * the rules again on a new phone costs one dismissal.
 *
 * `gameId` is optional because not every surface rendering a play screen knows
 * one; no id (or an id with no rules written) yields `rules: null`, and callers
 * then render no Rules control at all rather than an empty sheet.
 */
export function useGameRules(gameId: string | undefined): GameRulesState {
  const rules = gameId === undefined ? undefined : rulesFor(gameId);
  const [isOpen, setIsOpen] = useState(false);

  // Which game we've already decided about this mount. Guards against the
  // effect re-running (React 18 StrictMode double-invoke, a re-render with a
  // new `rules` identity) and re-opening a sheet the player just dismissed —
  // while still firing again if the screen genuinely switches games underneath
  // us, which is exactly what the action bar's prev/next do.
  const decidedFor = useRef<string | null>(null);

  useEffect(() => {
    if (gameId === undefined || rules === undefined) return;
    if (decidedFor.current === gameId) return;
    decidedFor.current = gameId;
    if (!hasSeenRules(gameId)) setIsOpen(true);
  }, [gameId, rules]);

  // Marked on *open*, not on dismiss: a player who reads the sheet and then
  // navigates away without touching it has still seen it, and reopening it on
  // their next visit would read as the app not noticing.
  useEffect(() => {
    if (isOpen && gameId !== undefined) markRulesSeen(gameId);
  }, [isOpen, gameId]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { rules: rules ?? null, isOpen, open, close };
}
