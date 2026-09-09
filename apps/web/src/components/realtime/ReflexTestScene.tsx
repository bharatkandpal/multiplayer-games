import {
  REFLEX,
  averageTimeMs,
  bestTimeMs,
  currentReactionMs,
  type ReflexState,
} from "@mpg/engine";
import type { RealtimeSceneProps } from "../../screens/RealtimePlayScreen";
import { VisuallyHidden } from "../ui";
import { cx } from "../ui/cx";
import styles from "./ReflexTestScene.module.css";

/**
 * The Reflex Test renderer. Draws the signal panel + per-round times PURELY from
 * `ReflexState` (no state of its own, no clock, no randomness), exactly like the
 * other real-time scenes: a snapshot in → a frame out.
 *
 * DOM rather than Canvas (unlike Floppy Birds / Drunk Walk). There is nothing to
 * animate here — the scene is one large colour field and some numbers — and the
 * numbers ARE the game's output, so rendering them as real text gets us crisp
 * type, free reflow, and screen-reader access for nothing. This scene is
 * therefore NOT `aria-hidden`, where the canvas-based ones are.
 *
 * Colour is never the only signal (UX DoD): the panel always carries a word
 * ("WAIT" / "GO — TAP!") and a distinct glyph alongside red/green, so the game is
 * playable with any form of colour blindness.
 */

/** Formats a reaction time for display — whole milliseconds, e.g. "215 ms". */
function formatMs(ms: number): string {
  return `${Math.round(ms)} ms`;
}

export function ReflexTestScene({
  state,
  phase,
}: RealtimeSceneProps<ReflexState>): React.JSX.Element {
  const best = bestTimeMs(state);
  const average = averageTimeMs(state);

  // Before the run starts the panel is inert: showing a live red "WAIT" on the
  // ready overlay would start the player reacting to a signal that isn't running.
  const idle = phase === "ready";
  const showFalseStart = state.falseStart;
  // The final round leaves `light` on "go" (nothing flips it back), so without
  // this the finished run sat on a green "GO — TAP!" panel — inviting a tap at
  // the one moment there is nothing left to tap.
  const finished = state.over && !showFalseStart;
  const isGo = state.light === "go" && !finished;

  const panelLabel = showFalseStart
    ? "Too soon!"
    : finished
      ? "All 5 rounds done"
      : isGo
        ? "GO — TAP!"
        : "WAIT";
  const panelGlyph = showFalseStart ? "✕" : finished ? "🏁" : isGo ? "⚡" : "✋";

  return (
    <div className={styles.scene}>
      <div
        className={cx(
          styles.panel,
          (idle || finished) && styles.panelIdle,
          !idle && !finished && !showFalseStart && (isGo ? styles.panelGo : styles.panelWait),
          showFalseStart && styles.panelFalseStart,
        )}
        data-light={
          showFalseStart ? "false-start" : idle ? "idle" : finished ? "finished" : state.light
        }
      >
        <span className={styles.panelGlyph} aria-hidden="true">
          {panelGlyph}
        </span>
        <span className={styles.panelLabel}>{idle ? "Ready" : panelLabel}</span>
        {showFalseStart ? (
          <span className={styles.panelSub}>You tapped before the panel turned green.</span>
        ) : null}
        {isGo ? (
          <span className={styles.panelSub}>{formatMs(currentReactionMs(state))}</span>
        ) : null}
      </div>

      <p className={styles.roundLine}>
        Round <strong>{Math.min(state.roundIndex + 1, REFLEX.rounds)}</strong> of {REFLEX.rounds}
      </p>

      {/* Per-round times. Rendered as a list (not a bare row of numbers) so the
          structure is announced, with pending rounds explicitly marked rather
          than left as an ambiguous dash. */}
      <ol className={styles.times}>
        {Array.from({ length: REFLEX.rounds }, (_, i) => {
          const time = state.times[i];
          return (
            <li
              key={i}
              className={cx(styles.timeChip, time === undefined && styles.timeChipPending)}
            >
              <span className={styles.timeIndex}>{i + 1}</span>
              <span className={styles.timeValue}>
                {time === undefined ? (
                  <>
                    <span aria-hidden="true">—</span>
                    <VisuallyHidden>not yet played</VisuallyHidden>
                  </>
                ) : (
                  formatMs(time)
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <dl className={styles.summary}>
        <div className={styles.summaryItem}>
          <dt className={styles.summaryLabel}>Best</dt>
          <dd className={styles.summaryValue}>{best === null ? "—" : formatMs(best)}</dd>
        </div>
        <div className={styles.summaryItem}>
          <dt className={styles.summaryLabel}>Average</dt>
          <dd className={styles.summaryValue}>{average === null ? "—" : formatMs(average)}</dd>
        </div>
      </dl>
    </div>
  );
}
