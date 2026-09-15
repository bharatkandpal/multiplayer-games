import type { GomokuLine, GomokuMove, GomokuState } from "@mpg/engine";
import type { AppliedMove } from "../../game";
import { cx } from "../ui/cx";
import { BoardGrid } from "./BoardGrid";
import type { WinningTone } from "./BoardGrid";
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
  winningLineTone?: WinningTone;
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
 * 9x9 Gomoku board — the shared `BoardGrid` (UI-10) at `dense`, which is what
 * that density exists for. Gomoku's own layer is the labelling and the
 * shape-distinct stones.
 *
 * Sizing note: unlike the 3x3 boards, a 9x9 grid cannot give every cell the
 * 44px minimum touch target on a narrow phone (that alone would need ~400px of
 * board width), so `dense` drops the floor to 0. The board scales to the
 * available width and the cells shrink with it, which keeps the whole position
 * visible — the alternative, a horizontally-scrolling board, would cost the
 * at-a-glance overview that a five-in-a-row game depends on. Cells stay square
 * and comfortably tappable at typical phone widths; see MPG-020 for the wider
 * responsive/a11y pass on that trade.
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
  const winningCells = winningLine ? new Set(winningLine.map((c) => cellKey(c.row, c.col))) : null;

  return (
    <BoardGrid
      rows={size}
      cols={size}
      label="Gomoku board"
      disabled={disabled}
      density="dense"
      maxWidth="32rem"
      winningTone={winningLineTone}
      cell={(row, col) => {
        const mark = (state.board[row]?.[col] ?? null) as 1 | 2 | null;
        return {
          content: mark ? <Stone mark={mark} /> : null,
          label: cellLabel(mark, row, col),
          activatable: mark === null && !disabled,
          lastMove: lastMove?.move.row === row && lastMove?.move.col === col,
          winning: winningCells?.has(cellKey(row, col)) ?? false,
        };
      }}
      onActivate={(row, col) => onMove({ row, col })}
    />
  );
}
