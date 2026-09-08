import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { GomokuLine, GomokuMove, GomokuState } from "@mpg/engine";
import type { AppliedMove } from "../../game";
import { cx } from "../ui/cx";
import styles from "./GomokuBoard.module.css";

export interface GomokuBoardProps {
  state: GomokuState;
  /** Called with the move when an empty cell is activated. Ignored while `disabled`. */
  onMove: (move: GomokuMove) => void;
  /** True when it isn't the local human's turn (bot thinking, game over, spectating). */
  disabled: boolean;
  lastMove: AppliedMove<GomokuMove> | null;
  /** The 5 winning {row,col} cells once the game is won, else null — highlighted. */
  winningLine?: GomokuLine | null;
  /**
   * How the winning-line highlight should read (MPG-046): "win" (default,
   * green/success) or "loss" (red/danger) — reserved for the one
   * unambiguous case, a sole local human losing. Never color-only: the
   * ring/glow shape stays identical, only the hue changes.
   */
  winningLineTone?: "win" | "loss";
}

/** Stable key for a {row,col} cell, for winning-line membership checks. */
function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function cellLabel(mark: 1 | 2 | null, row: number, col: number): string {
  const position = `Row ${row + 1}, column ${col + 1}`;
  if (mark === 1) return `${position}, black`;
  if (mark === 2) return `${position}, white`;
  return `${position}, empty`;
}

/**
 * A stone. Never color-only: player 1 is a solid disc and player 2 is a hollow
 * ring, so the two sides stay distinguishable without color — the same
 * shape-first convention as Tic-Tac-Toe's X/O glyphs.
 */
function Stone({ mark }: { mark: 1 | 2 }): React.JSX.Element {
  if (mark === 1) {
    return (
      <svg viewBox="0 0 24 24" className={cx(styles.stone, styles.stoneP1)} aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={cx(styles.stone, styles.stoneP2)} aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
    </svg>
  );
}

/**
 * 9x9 Gomoku board. Cells are individually-focusable buttons with a roving
 * tabindex and 2D arrow-key navigation (WAI-ARIA grid pattern), full labels for
 * assistive tech, and shape-distinct stones. Interaction is disabled (but still
 * visible/legible) whenever it isn't the local human's turn.
 *
 * Sizing note: unlike the 3x3 boards, a 9x9 grid cannot give every cell the
 * 44px minimum touch target on a narrow phone (that alone would need ~400px of
 * board width). The board therefore scales to the available width and the cells
 * shrink with it, which keeps the whole position visible — the alternative,
 * a horizontally-scrolling board, would cost the at-a-glance overview that a
 * five-in-a-row game depends on. Cells stay square and comfortably tappable at
 * typical phone widths; see MPG-020 for the wider responsive/a11y pass.
 */
export function GomokuBoard({
  state,
  onMove,
  disabled,
  lastMove,
  winningLine = null,
  winningLineTone = "win",
}: GomokuBoardProps): React.JSX.Element {
  const size = state.board.length;
  const [focusCell, setFocusCell] = useState({ row: 0, col: 0 });
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const winningCells = winningLine ? new Set(winningLine.map((c) => cellKey(c.row, c.col))) : null;

  const moveTo = (row: number, col: number): void => {
    const nextRow = ((row % size) + size) % size;
    const nextCol = ((col % size) + size) % size;
    setFocusCell({ row: nextRow, col: nextCol });
    cellRefs.current[nextRow * size + nextCol]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, row: number, col: number) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveTo(row, col + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveTo(row, col - 1);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveTo(row + 1, col);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveTo(row - 1, col);
        break;
      case "Home":
        event.preventDefault();
        moveTo(row, 0);
        break;
      case "End":
        event.preventDefault();
        moveTo(row, size - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div className={styles.board} role="grid" aria-label="Gomoku board" aria-disabled={disabled}>
      {Array.from({ length: size }, (_, row) => (
        <div key={row} role="row" className={styles.row}>
          {Array.from({ length: size }, (_, col) => {
            const mark = state.board[row]?.[col] as 1 | 2 | null | undefined;
            const isEmpty = mark === null || mark === undefined;
            const isLastMove = lastMove?.move.row === row && lastMove?.move.col === col;
            const isWinning = winningCells?.has(cellKey(row, col)) ?? false;
            const isActivatable = isEmpty && !disabled;
            return (
              <button
                key={col}
                ref={(el) => {
                  cellRefs.current[row * size + col] = el;
                }}
                type="button"
                role="gridcell"
                className={cx(
                  styles.cell,
                  isLastMove && styles.lastMove,
                  isWinning && (winningLineTone === "loss" ? styles.winningLoss : styles.winning),
                )}
                tabIndex={row === focusCell.row && col === focusCell.col ? 0 : -1}
                aria-disabled={!isActivatable}
                aria-label={cellLabel(mark ?? null, row, col)}
                onFocus={() => setFocusCell({ row, col })}
                onKeyDown={(event) => handleKeyDown(event, row, col)}
                onClick={() => {
                  if (!isActivatable) return;
                  onMove({ row, col });
                }}
              >
                {mark ? <Stone mark={mark} /> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
