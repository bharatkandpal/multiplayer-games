import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { NimLine, NimMove, NimState } from "@mpg/engine";
import type { AppliedMove } from "../../game";
import { Button, VisuallyHidden } from "../ui";
import { cx } from "../ui/cx";
import styles from "./NimBoard.module.css";

export interface NimBoardProps {
  state: NimState;
  /** Called with the move once a pile + count is selected and confirmed. Ignored while `disabled`. */
  onMove: (move: NimMove) => void;
  /** True when it isn't the local human's turn (bot thinking, game over, spectating). */
  disabled: boolean;
  lastMove: AppliedMove<NimMove> | null;
  /** Every (now-empty) pile index once the game is won, else null — highlighted. */
  winningLine?: NimLine | null;
  /**
   * How the winning highlight should read (mirrors the other boards): "win"
   * (default, green/success) or "loss" (red/danger) — reserved for the one
   * unambiguous case, a sole local human losing.
   */
  winningLineTone?: "win" | "loss";
}

/** How long the "just taken" ghost tokens stay visible while fading out. Kept
 * in step with `--duration-slow` in NimBoard.module.css. */
const FADE_MS = 420;
/** How long an illegal-selection warning stays up before self-clearing. */
const WARNING_MS = 2500;

function pileLabel(index: number, size: number, selected: boolean): string {
  const base =
    size === 0
      ? `Pile ${index + 1}, empty`
      : `Pile ${index + 1}, ${size} object${size === 1 ? "" : "s"} remaining`;
  return selected ? `${base}, selected` : base;
}

/**
 * Nim board: a row of piles, each a token count. Interaction is a two-step
 * select-then-confirm flow (mirrors `TicTacToeMoveBoard`'s select-then-target
 * pattern, adapted for a numeric choice instead of a spatial one):
 *
 * 1. Activate a non-empty pile (click, or Enter/Space via keyboard) to select it.
 * 2. A stepper appears — adjust the count (1..pile size) with −/+, then confirm
 *    with "Take N" (or Escape/Cancel to back out without moving).
 *
 * Piles form a single-select `radiogroup` with roving-tabindex arrow-key
 * navigation. Selection and the "just taken" highlight are never color-only
 * (dashed ring / pulse + text), and activating an empty pile gives an
 * explicit, self-clearing warning instead of silently doing nothing.
 *
 * On top of that fully keyboard/AT-operable flow, individual tokens are a
 * mouse/touch-only enhancement: clicking a token directly selects its pile
 * AND sets the count in one motion ("take from here to the end" — clicking
 * deeper into the pile takes more), and hovering previews that count on the
 * tokens before committing to the click. Tokens stay `aria-hidden` and
 * un-tabbable — this is strictly additive convenience layered over the
 * stepper, never a replacement for it, so nothing here can leave a
 * keyboard/AT user with less than the base flow above.
 */
export function NimBoard({
  state,
  onMove,
  disabled,
  lastMove,
  winningLine = null,
  winningLineTone = "win",
}: NimBoardProps): React.JSX.Element {
  const [focusIndex, setFocusIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const [warning, setWarning] = useState<string | null>(null);
  // Live "if you click here, this many will go" preview — set on token
  // hover, cleared on leaving the pile. Mouse/touch-only enhancement; never
  // the only way to see the pending count (the stepper readout below always
  // shows it too).
  const [hoverPreview, setHoverPreview] = useState<{ pile: number; count: number } | null>(null);
  const pileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const winningPiles = winningLine ? new Set<number>(winningLine) : null;

  // A move just landed (this player's own optimistic move, a bot's move, or a
  // reconciled server broadcast) — the pile+count it came from is stale as a
  // pending selection, so drop it. Depending on `lastMove` identity (a fresh
  // object per applied move) rather than `state.piles` keeps this from firing
  // on every unrelated re-render.
  useEffect(() => {
    setSelected(null);
    setCount(1);
    setHoverPreview(null);
  }, [lastMove]);

  // Ephemeral "ghost" tokens fading out of the pile that was just taken from —
  // purely additive over the authoritative `state.piles` count, and self-clears
  // after the fade so it never leaves permanent extra layout behind.
  const [fading, setFading] = useState<{ pile: number; count: number } | null>(null);
  useEffect(() => {
    if (!lastMove) return;
    setFading({ pile: lastMove.move.pile, count: lastMove.move.count });
    const timer = setTimeout(() => setFading(null), FADE_MS);
    return () => clearTimeout(timer);
  }, [lastMove]);

  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), WARNING_MS);
    return () => clearTimeout(timer);
  }, [warning]);

  const pileCount = state.piles.length;

  const moveFocusTo = (nextIndex: number): void => {
    const clamped = ((nextIndex % pileCount) + pileCount) % pileCount;
    setFocusIndex(clamped);
    pileRefs.current[clamped]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveFocusTo(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveFocusTo(index - 1);
        break;
      case "Home":
        event.preventDefault();
        moveFocusTo(0);
        break;
      case "End":
        event.preventDefault();
        moveFocusTo(pileCount - 1);
        break;
      case "Escape":
        if (selected !== null) {
          event.preventDefault();
          setSelected(null);
        }
        break;
      default:
        break;
    }
  };

  const activatePile = (index: number): void => {
    if (disabled) return;
    const size = state.piles[index] ?? 0;
    if (size === 0) {
      setWarning(`Pile ${index + 1} is empty — choose another pile.`);
      return;
    }
    setWarning(null);
    if (selected === index) {
      setSelected(null); // re-activating the selected pile deselects
      return;
    }
    setSelected(index);
    setCount(1);
  };

  const selectedSize = selected !== null ? (state.piles[selected] ?? 0) : 0;

  /**
   * Clicking a specific token selects its pile and sets the count to "take
   * from here through the end" in one motion — `tokenIndex` counts from the
   * kept end, so the count taken is everything from that token onward.
   * `stopPropagation` keeps this from ALSO bubbling to the pile button's own
   * `onClick` (`activatePile`), which has different toggle-select semantics.
   */
  const handleTokenClick = (
    event: MouseEvent,
    pileIndex: number,
    tokenIndex: number,
    size: number,
  ): void => {
    event.stopPropagation();
    if (disabled || size === 0) return;
    setWarning(null);
    setSelected(pileIndex);
    setCount(size - tokenIndex);
  };

  const previewCountFor = (pileIndex: number, isSelected: boolean): number => {
    if (hoverPreview?.pile === pileIndex) return hoverPreview.count;
    return isSelected ? count : 0;
  };

  const confirmTake = (): void => {
    if (selected === null || disabled) return;
    onMove({ pile: selected, count });
    setSelected(null);
    setCount(1);
  };

  const cancelSelection = (): void => {
    setSelected(null);
    setCount(1);
  };

  const prompt =
    selected === null
      ? "Select a pile to take from."
      : `Choose how many to take from pile ${selected + 1} (1–${selectedSize}).`;

  return (
    <div className={styles.wrapper}>
      <p className={styles.prompt}>{prompt}</p>
      <VisuallyHidden>
        <div aria-live="polite" role="status">
          {prompt}
        </div>
      </VisuallyHidden>

      <div
        className={styles.piles}
        role="radiogroup"
        aria-label="Nim piles"
        aria-disabled={disabled}
      >
        {state.piles.map((size, index) => {
          const isSelected = selected === index;
          const isEmpty = size === 0;
          const isActivatable = !disabled && !isEmpty;
          const isLastMovePile = lastMove?.move.pile === index;
          const isWinning = winningPiles?.has(index) ?? false;
          const ghostCount = fading && fading.pile === index ? fading.count : 0;
          const slots = size + ghostCount;
          const previewCount = previewCountFor(index, isSelected);
          const isHoverPreview = hoverPreview?.pile === index;

          return (
            <button
              key={index}
              ref={(el) => {
                pileRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-disabled={!isActivatable}
              aria-label={pileLabel(index, size, isSelected)}
              tabIndex={index === focusIndex ? 0 : -1}
              className={cx(
                styles.pile,
                isSelected && styles.selected,
                isEmpty && styles.empty,
                isLastMovePile && styles.justTaken,
                isWinning && (winningLineTone === "loss" ? styles.winningLoss : styles.winning),
              )}
              onFocus={() => setFocusIndex(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onClick={() => activatePile(index)}
              onMouseLeave={() =>
                setHoverPreview((current) => (current?.pile === index ? null : current))
              }
            >
              <span className={styles.pileName}>Pile {index + 1}</span>
              <span className={styles.tokenRow} aria-hidden="true">
                {Array.from({ length: slots }, (_, tokenIndex) => {
                  // Ghost slots (already-removed, fading out) aren't real
                  // tokens — they don't get click/hover handlers, and
                  // `size - tokenIndex` would be <= 0 for one anyway.
                  const isRealToken = tokenIndex < size;
                  return (
                    <span
                      key={tokenIndex}
                      className={cx(
                        styles.token,
                        !isRealToken && styles.tokenGhost,
                        isRealToken &&
                          tokenIndex >= size - previewCount &&
                          (isHoverPreview ? styles.tokenHoverTake : styles.tokenPendingTake),
                      )}
                      onClick={
                        isActivatable && isRealToken
                          ? (event) => handleTokenClick(event, index, tokenIndex, size)
                          : undefined
                      }
                      onMouseEnter={
                        isActivatable && isRealToken
                          ? () => setHoverPreview({ pile: index, count: size - tokenIndex })
                          : undefined
                      }
                    />
                  );
                })}
                {size === 0 ? <span className={styles.emptyMark}>—</span> : null}
              </span>
              <span className={styles.pileCount}>{size}</span>
            </button>
          );
        })}
      </div>

      {warning ? (
        <p className={styles.warning} role="alert">
          {warning}
        </p>
      ) : null}

      {selected !== null ? (
        <div className={styles.stepper} role="group" aria-label={`Take from pile ${selected + 1}`}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Decrease count"
            disabled={disabled || count <= 1}
            onClick={() => setCount((c) => Math.max(1, c - 1))}
          >
            −
          </Button>
          <span className={styles.stepperCount} role="status" aria-live="polite">
            {count}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Increase count"
            disabled={disabled || count >= selectedSize}
            onClick={() => setCount((c) => Math.min(selectedSize, c + 1))}
          >
            +
          </Button>
          <Button variant="primary" size="sm" disabled={disabled} onClick={confirmTake}>
            Take {count}
          </Button>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={cancelSelection}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
