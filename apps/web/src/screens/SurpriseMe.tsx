import { useCallback, useEffect, useRef, useState } from "react";
import { getSurpriseSpinMs } from "../game/motion";
import { pickRandomGame } from "./randomGame";
import type { CatalogEntry } from "./catalog";
import styles from "./SurpriseMe.module.css";

/**
 * "Surprise me" (MPG-143) — one tap, one random game, straight into play.
 *
 * The shape of this component is one decision repeated three times: **the pick is
 * made first, synchronously, and the shuffle is decoration over it.**
 *
 *   - Skipping the shuffle can never change which game you get, so skipping is
 *     safe to offer at any instant — tap again, Enter, or Escape.
 *   - `prefers-reduced-motion` zeroes `--duration-surprise-spin`, so that player
 *     goes straight into the game instead of watching a stripped animation.
 *   - If the component unmounts mid-shuffle, nothing is left half-decided.
 *
 * That matters because a deliberate delay in front of gameplay brushes against
 * the rule in `docs/UX_PRINCIPLES.md` §7 ("never block or delay gameplay"). It is
 * defensible here — the delay is local, it is the thing the player asked for by
 * pressing a dice button, and it is always skippable — but the moment it becomes
 * unskippable, or the moment it starts doing real work (a request, a decision),
 * it is in breach.
 *
 * Offline-safe by construction: no network, no service, nothing to degrade.
 */

/** How often the shuffle swaps the game shown, while it runs. */
const FRAME_MS = 90;

export interface SurpriseMeProps {
  /** The games the dice may land on — Home passes what's currently VISIBLE. */
  entries: readonly CatalogEntry[];
  /** Launch the chosen game. Called once, after the shuffle (or immediately). */
  onPick: (entry: CatalogEntry) => void;
}

export function SurpriseMe({ entries, onPick }: SurpriseMeProps): React.JSX.Element | null {
  // The game the shuffle is currently showing. `null` means it isn't running.
  const [spinning, setSpinning] = useState<CatalogEntry | null>(null);
  // The id the dice last landed on, so the next press can avoid repeating it.
  const lastPickRef = useRef<string | undefined>(undefined);
  // The already-decided winner, held while the shuffle plays out.
  const winnerRef = useRef<CatalogEntry | null>(null);
  const timersRef = useRef<{ frame?: number; land?: number }>({});

  const clearTimers = useCallback((): void => {
    if (timersRef.current.frame !== undefined) window.clearInterval(timersRef.current.frame);
    if (timersRef.current.land !== undefined) window.clearTimeout(timersRef.current.land);
    timersRef.current = {};
  }, []);

  // Never leave a timer (or a half-finished shuffle) behind.
  useEffect(() => clearTimers, [clearTimers]);

  const land = useCallback((): void => {
    clearTimers();
    const winner = winnerRef.current;
    winnerRef.current = null;
    setSpinning(null);
    if (winner) {
      lastPickRef.current = winner.id;
      onPick(winner);
    }
  }, [clearTimers, onPick]);

  const start = useCallback((): void => {
    // Already shuffling? Then this press means "stop teasing me" — land now.
    if (winnerRef.current !== null) {
      land();
      return;
    }

    const winner = pickRandomGame(entries, { exclude: lastPickRef.current });
    if (!winner) return;
    winnerRef.current = winner;

    const spinMs = getSurpriseSpinMs();
    if (spinMs <= 0) {
      land();
      return;
    }

    setSpinning(winner);
    timersRef.current.frame = window.setInterval(() => {
      // Pure decoration: which game flashes past is irrelevant to the outcome.
      setSpinning(pickRandomGame(entries) ?? winner);
    }, FRAME_MS);
    timersRef.current.land = window.setTimeout(land, spinMs);
  }, [entries, land]);

  // Escape abandons the tease and goes to the game — the pick is already made,
  // so there is nothing here that "cancel" could honestly mean.
  useEffect(() => {
    if (spinning === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        land();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spinning, land]);

  // Nothing to pick from → no control at all, rather than a button that does
  // nothing (UX_PRINCIPLES §7: degrade to absence).
  if (entries.length === 0) return null;

  const isSpinning = spinning !== null;

  return (
    <button
      type="button"
      className={styles.surprise}
      onClick={start}
      // The label is the promise: after the shuffle, you are IN a game. It also
      // changes while spinning, so a screen-reader user isn't told "Surprise me"
      // by a button that currently means "skip".
      aria-label={isSpinning ? "Skip the shuffle and play now" : "Surprise me — play a random game"}
      data-spinning={isSpinning ? "true" : undefined}
    >
      <span className={styles.face} aria-hidden="true">
        <DiceIcon />
      </span>
      {/* The shuffle cycles TITLES, not thumbnails. A card thumbnail shrunk to
          button size is a smudge — the name is the thing a player can actually
          read going past, and reading the names is what makes the shuffle feel
          like the catalogue rather than like a loading spinner. */}
      <span className={styles.label}>
        {isSpinning && spinning ? spinning.title : "Surprise me"}
      </span>
      {/* Announced once the dice lands, so the change of screen is never silent. */}
      <span className={styles.srOnly} role="status">
        {isSpinning && spinning ? `Picking a game… ${spinning.title}` : ""}
      </span>
    </button>
  );
}

function DiceIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={styles.dice} aria-hidden="true" focusable="false">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      {[
        [8, 8],
        [16, 8],
        [12, 12],
        [8, 16],
        [16, 16],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" fill="currentColor" />
      ))}
    </svg>
  );
}
