import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ConnectFourLine, ConnectFourMove, ConnectFourState } from "@mpg/engine";
import type { AppliedMove } from "../../game";
import { cx } from "../ui/cx";
import styles from "./ConnectFourBoard.module.css";

export interface ConnectFourBoardProps {
  state: ConnectFourState;
  /** Called with the move when a non-full column is activated. Ignored while `disabled`. */
  onMove: (move: ConnectFourMove) => void;
  /** True when it isn't the local human's turn (bot thinking, game over, spectating). */
  disabled: boolean;
  lastMove: AppliedMove<ConnectFourMove> | null;
  /** The 4 winning {column,row} cells once the game is won, else null — highlighted. */
  winningLine?: ConnectFourLine | null;
  /**
   * How the winning-line highlight should read (MPG-046): "win" (default,
   * green/success) or "loss" (red/danger) — reserved for the one
   * unambiguous case, a sole local human losing. Never color-only: the
   * ring/glow shape stays identical, only the hue changes.
   */
  winningLineTone?: "win" | "loss";
}

/** Stable key for a {column,row} cell, for winning-line membership checks. */
function cellKey(column: number, row: number): string {
  return `${column},${row}`;
}

/** The row (from the top) the most recently-dropped disc in `column` landed in. */
function topFilledRow(state: ConnectFourState, column: number): number | null {
  const col = state.board[column];
  if (!col) return null;
  for (let row = col.length - 1; row >= 0; row--) {
    if (col[row] !== null && col[row] !== undefined) return row;
  }
  return null;
}

function discClassName(mark: 1 | 2): string | undefined {
  return mark === 1 ? styles.discPlayer1 : styles.discPlayer2;
}

/**
 * 7x6 Connect Four board. Interaction is by column: clicking/activating a column
 * (or its cells) drops a disc into the lowest empty row. Column buttons form a
 * roving-tabindex row (arrow-key navigable); discs render bottom-up per the
 * engine's column-major state, and the two sides are distinguished by fill
 * pattern (solid vs. striped), not color alone.
 */
export function ConnectFourBoard({
  state,
  onMove,
  disabled,
  lastMove,
  winningLine = null,
  winningLineTone = "win",
}: ConnectFourBoardProps): React.JSX.Element {
  const columnCount = state.board.length;
  const rowCount = state.board[0]?.length ?? 0;
  const [focusColumn, setFocusColumn] = useState(0);
  const columnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const winningCells = winningLine
    ? new Set(winningLine.map((c) => cellKey(c.column, c.row)))
    : null;

  const isColumnFull = (column: number): boolean => {
    const col = state.board[column];
    return col === undefined || col.every((cell) => cell !== null);
  };

  const moveFocusTo = (nextColumn: number): void => {
    const clamped = ((nextColumn % columnCount) + columnCount) % columnCount;
    setFocusColumn(clamped);
    columnRefs.current[clamped]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, column: number): void => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveFocusTo(column + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveFocusTo(column - 1);
        break;
      case "Home":
        event.preventDefault();
        moveFocusTo(0);
        break;
      case "End":
        event.preventDefault();
        moveFocusTo(columnCount - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      className={styles.board}
      role="group"
      aria-label="Connect Four board"
      aria-disabled={disabled}
    >
      <div
        className={styles.grid}
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columnCount }, (_, column) => {
          const full = isColumnFull(column);
          const isActivatable = !full && !disabled;
          const lastMoveRow = lastMove?.move.column === column ? topFilledRow(state, column) : null;
          return (
            <button
              key={column}
              ref={(el) => {
                columnRefs.current[column] = el;
              }}
              type="button"
              className={styles.column}
              tabIndex={column === focusColumn ? 0 : -1}
              aria-disabled={!isActivatable}
              aria-label={
                full ? `Column ${column + 1}, full` : `Drop a disc in column ${column + 1}`
              }
              onFocus={() => setFocusColumn(column)}
              onKeyDown={(event) => handleKeyDown(event, column)}
              onClick={() => {
                if (!isActivatable) return;
                onMove({ column });
              }}
            >
              {Array.from({ length: rowCount }, (_, rowFromTop) => {
                const row = rowCount - 1 - rowFromTop;
                const mark = state.board[column]?.[row] as 1 | 2 | null | undefined;
                const isWinning = winningCells?.has(cellKey(column, row)) ?? false;
                return (
                  <span key={row} className={styles.cell}>
                    {mark ? (
                      <span
                        className={cx(
                          styles.disc,
                          discClassName(mark),
                          lastMoveRow === row && styles.lastMove,
                          isWinning &&
                            (winningLineTone === "loss" ? styles.winningLoss : styles.winning),
                        )}
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
