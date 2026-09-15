import { useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { cx } from "../ui/cx";
import styles from "./BoardGrid.module.css";

/** How a winning-line highlight should read (MPG-046). */
export type WinningTone = "win" | "loss";

/** What a board wants rendered in one cell. Everything game-specific lives here. */
export interface BoardCellSpec {
  /** The mark, stone or glyph to render inside the cell. */
  content?: ReactNode;
  /** Full accessible label, e.g. "Row 2, column 3, empty". */
  label: string;
  /**
   * False renders the cell `aria-disabled` and swallows activation. The cell
   * stays focusable and legible either way — a disabled board is still a board
   * you can read and tab through.
   */
  activatable: boolean;
  /** Ring this cell as the most recent move. */
  lastMove?: boolean;
  /** Ring and pulse this cell as part of the winning line. */
  winning?: boolean;
  /** Game-specific modifier classes (Move-Mode's `selected` / `validTarget`). */
  className?: string;
  /**
   * `aria-pressed` for toggle-like cells; omit for plain cells. Explicitly
   * `| undefined` because the workspace runs `exactOptionalPropertyTypes`, and
   * a board computing "pressed, or not applicable here" wants to pass the
   * absence through rather than build a conditional spread around it.
   */
  pressed?: boolean | undefined;
}

export interface BoardGridProps {
  rows: number;
  cols: number;
  /** `aria-label` for the grid, e.g. "Gomoku board". */
  label: string;
  /** True when it isn't the local human's turn (bot thinking, game over, spectating). */
  disabled: boolean;
  /**
   * Longest inline size the board may take — the first term of the MPG-137
   * clamp. A CSS length, e.g. `"22rem"`.
   */
  maxWidth: string;
  /**
   * The height the board may claim, the clamp's second term. Defaults to the
   * whole play-area container; pass a `calc()` when the board shares its
   * container with something else (Move-Mode's phase prompt).
   */
  heightBudget?: string;
  /** Cell density. `"dense"` is for 9x9 and up — see `BoardGrid.module.css`. */
  density?: "comfortable" | "dense";
  /** Hue for cells marked `winning`. */
  winningTone?: WinningTone;
  /** Called for each cell to build its spec. */
  cell: (row: number, col: number) => BoardCellSpec;
  /** Activation (click or Enter/Space) of a cell whose spec is `activatable`. */
  onActivate: (row: number, col: number) => void;
  /**
   * Runs before the built-in arrow/Home/End handling, for game-specific keys
   * (Move-Mode's Escape-to-deselect). Call `preventDefault()` to also suppress
   * the built-in handling for that key.
   */
  onCellKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, row: number, col: number) => void;
}

/**
 * The shared board primitive (UI-10 / MPG-117): one cell grammar, one roving
 * tabindex, one set of state rings, for every row/column board in the
 * catalogue.
 *
 * It owns the WAI-ARIA grid pattern — a `role="grid"` of `role="row"`s of
 * focusable `role="gridcell"` buttons, with 2D arrow-key navigation that wraps
 * at the edges plus Home/End along the row — and the MPG-137 height clamp that
 * keeps a board inside the frame instead of pushing the pinned action bar off
 * it. Boards supply only what is theirs: what a cell is labelled, what is drawn
 * in it, and what a move means.
 *
 * Connect Four and Nim deliberately do not use it. Their interactive object is
 * a column and a pile, not a cell, so forcing them through a grid of cells
 * would be a worse fit than the shared `--board-*` tokens they read instead.
 */
export function BoardGrid({
  rows,
  cols,
  label,
  disabled,
  maxWidth,
  heightBudget = "100cqh",
  density = "comfortable",
  winningTone = "win",
  cell,
  onActivate,
  onCellKeyDown,
}: BoardGridProps): React.JSX.Element {
  const [focusCell, setFocusCell] = useState({ row: 0, col: 0 });
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveFocusTo = (row: number, col: number): void => {
    const nextRow = ((row % rows) + rows) % rows;
    const nextCol = ((col % cols) + cols) % cols;
    setFocusCell({ row: nextRow, col: nextCol });
    cellRefs.current[nextRow * cols + nextCol]?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    row: number,
    col: number,
  ): void => {
    onCellKeyDown?.(event, row, col);
    if (event.defaultPrevented) return;

    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveFocusTo(row, col + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveFocusTo(row, col - 1);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveFocusTo(row + 1, col);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocusTo(row - 1, col);
        break;
      case "Home":
        event.preventDefault();
        moveFocusTo(row, 0);
        break;
      case "End":
        event.preventDefault();
        moveFocusTo(row, cols - 1);
        break;
      default:
        break;
    }
  };

  const sizing = {
    "--board-max-inline": maxWidth,
    "--board-height-budget": heightBudget,
    "--board-aspect": `${cols / rows}`,
    "--board-rows": `${rows}`,
    "--board-cols": `${cols}`,
  } as CSSProperties;

  return (
    <div
      className={cx(styles.board, density === "dense" && styles.dense)}
      style={sizing}
      role="grid"
      aria-label={label}
      aria-disabled={disabled}
    >
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} role="row" className={styles.row}>
          {Array.from({ length: cols }, (_, col) => {
            const spec = cell(row, col);
            return (
              <button
                key={col}
                ref={(el) => {
                  cellRefs.current[row * cols + col] = el;
                }}
                type="button"
                role="gridcell"
                className={cx(
                  styles.cell,
                  spec.lastMove && styles.lastMove,
                  spec.winning && (winningTone === "loss" ? styles.winningLoss : styles.winning),
                  spec.className,
                )}
                tabIndex={row === focusCell.row && col === focusCell.col ? 0 : -1}
                aria-disabled={!spec.activatable}
                aria-pressed={spec.pressed}
                aria-label={spec.label}
                onFocus={() => setFocusCell({ row, col })}
                onKeyDown={(event) => handleKeyDown(event, row, col)}
                onClick={() => {
                  if (!spec.activatable) return;
                  onActivate(row, col);
                }}
              >
                {spec.content}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
