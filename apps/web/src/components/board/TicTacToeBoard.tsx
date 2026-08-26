import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { TicTacToeLine, TicTacToeMove, TicTacToeState } from "@mpg/engine";
import type { AppliedMove } from "../../game";
import { cx } from "../ui/cx";
import styles from "./TicTacToeBoard.module.css";

export interface TicTacToeBoardProps {
  state: TicTacToeState;
  /** Called with the move when an empty cell is activated. Ignored while `disabled`. */
  onMove: (move: TicTacToeMove) => void;
  /** True when it isn't the local human's turn (bot thinking, game over, spectating). */
  disabled: boolean;
  lastMove: AppliedMove<TicTacToeMove> | null;
  /** The 3 winning cell indices once the game is won, else null — highlighted. */
  winningLine?: TicTacToeLine | null;
  /**
   * How the winning-line highlight should read (MPG-046): "win" (default,
   * green/success) or "loss" (red/danger) — reserved for the one
   * unambiguous case, a sole local human losing. Never color-only: the
   * ring/glow shape stays identical, only the hue changes.
   */
  winningLineTone?: "win" | "loss";
}

const SIZE = 3;

function cellLabel(mark: 1 | 2 | null, row: number, col: number): string {
  const position = `Row ${row + 1}, column ${col + 1}`;
  if (mark === 1) return `${position}, X`;
  if (mark === 2) return `${position}, O`;
  return `${position}, empty`;
}

/**
 * X/O mark. Never color-only: X is a cross glyph, O is a ring glyph, each also
 * paired with `--color-player-1`/`--color-player-2` (colorblind-safe palette).
 */
function Mark({ mark }: { mark: 1 | 2 }): React.JSX.Element {
  if (mark === 1) {
    return (
      <svg viewBox="0 0 24 24" className={cx(styles.mark, styles.markX)} aria-hidden="true">
        <line x1="5" y1="5" x2="19" y2="19" />
        <line x1="19" y1="5" x2="5" y2="19" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={cx(styles.mark, styles.markO)} aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
    </svg>
  );
}

/**
 * 3x3 Tic-Tac-Toe board. Cells are individually-focusable buttons with a roving
 * tabindex + arrow-key navigation (WAI-ARIA grid pattern), full labels for
 * assistive tech, and shape-distinct marks. Interaction is disabled (but still
 * visible/legible) whenever it isn't the local human's turn.
 */
export function TicTacToeBoard({
  state,
  onMove,
  disabled,
  lastMove,
  winningLine = null,
  winningLineTone = "win",
}: TicTacToeBoardProps): React.JSX.Element {
  const [focusIndex, setFocusIndex] = useState(0);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const winningCells = winningLine ? new Set<number>(winningLine) : null;

  const moveTo = (nextIndex: number): void => {
    const clamped = ((nextIndex % (SIZE * SIZE)) + SIZE * SIZE) % (SIZE * SIZE);
    setFocusIndex(clamped);
    cellRefs.current[clamped]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveTo(row * SIZE + ((col + 1) % SIZE));
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveTo(row * SIZE + ((col - 1 + SIZE) % SIZE));
        break;
      case "ArrowDown":
        event.preventDefault();
        moveTo(((row + 1) % SIZE) * SIZE + col);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveTo(((row - 1 + SIZE) % SIZE) * SIZE + col);
        break;
      case "Home":
        event.preventDefault();
        moveTo(row * SIZE);
        break;
      case "End":
        event.preventDefault();
        moveTo(row * SIZE + (SIZE - 1));
        break;
      default:
        break;
    }
  };

  return (
    <div
      className={styles.board}
      role="grid"
      aria-label="Tic-Tac-Toe board"
      aria-disabled={disabled}
    >
      {Array.from({ length: SIZE }, (_, row) => (
        <div key={row} role="row" className={styles.row}>
          {Array.from({ length: SIZE }, (_, col) => {
            const index = row * SIZE + col;
            const mark = state.board[index] as 1 | 2 | null | undefined;
            const isEmpty = mark === null || mark === undefined;
            const isLastMove = lastMove?.move.cell === index;
            const isWinning = winningCells?.has(index) ?? false;
            const isActivatable = isEmpty && !disabled;
            return (
              <button
                key={index}
                ref={(el) => {
                  cellRefs.current[index] = el;
                }}
                type="button"
                role="gridcell"
                className={cx(
                  styles.cell,
                  isLastMove && styles.lastMove,
                  isWinning && (winningLineTone === "loss" ? styles.winningLoss : styles.winning),
                )}
                tabIndex={index === focusIndex ? 0 : -1}
                aria-disabled={!isActivatable}
                aria-label={cellLabel(mark ?? null, row, col)}
                onFocus={() => setFocusIndex(index)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                onClick={() => {
                  if (!isActivatable) return;
                  onMove({ cell: index });
                }}
              >
                {mark ? <Mark mark={mark} /> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
