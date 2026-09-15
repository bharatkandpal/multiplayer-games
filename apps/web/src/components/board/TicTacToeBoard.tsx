import type { TicTacToeLine, TicTacToeMove, TicTacToeState } from "@mpg/engine";
import type { AppliedMove } from "../../game";
import { cx } from "../ui/cx";
import { BoardGrid } from "./BoardGrid";
import type { WinningTone } from "./BoardGrid";
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
  winningLineTone?: WinningTone;
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
 * 3x3 Tic-Tac-Toe board. The cell grammar, roving tabindex, arrow-key
 * navigation and state rings all come from the shared `BoardGrid` (UI-10);
 * what is Tic-Tac-Toe's own is the labelling, the shape-distinct marks, and
 * what activating a cell means.
 */
export function TicTacToeBoard({
  state,
  onMove,
  disabled,
  lastMove,
  winningLine = null,
  winningLineTone = "win",
}: TicTacToeBoardProps): React.JSX.Element {
  const winningCells = winningLine ? new Set<number>(winningLine) : null;

  return (
    <BoardGrid
      rows={SIZE}
      cols={SIZE}
      label="Tic-Tac-Toe board"
      disabled={disabled}
      maxWidth="22rem"
      winningTone={winningLineTone}
      cell={(row, col) => {
        const index = row * SIZE + col;
        const mark = (state.board[index] ?? null) as 1 | 2 | null;
        return {
          content: mark ? <Mark mark={mark} /> : null,
          label: cellLabel(mark, row, col),
          activatable: mark === null && !disabled,
          lastMove: lastMove?.move.cell === index,
          winning: winningCells?.has(index) ?? false,
        };
      }}
      onActivate={(row, col) => onMove({ cell: row * SIZE + col })}
    />
  );
}
