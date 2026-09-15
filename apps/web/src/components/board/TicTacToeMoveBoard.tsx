import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { Player, TicTacToeMoveLine, TicTacToeMoveMove, TicTacToeMoveState } from "@mpg/engine";
import type { AppliedMove } from "../../game";
import { VisuallyHidden } from "../ui";
import { cx } from "../ui/cx";
import { BoardGrid } from "./BoardGrid";
import type { WinningTone } from "./BoardGrid";
import styles from "./TicTacToeMoveBoard.module.css";

export interface TicTacToeMoveBoardProps {
  state: TicTacToeMoveState;
  /** Called with the move when a placement or a relocation's target cell is activated. Ignored while `disabled`. */
  onMove: (move: TicTacToeMoveMove) => void;
  /** True when it isn't the local human's turn (bot thinking, game over, spectating). */
  disabled: boolean;
  lastMove: AppliedMove<TicTacToeMoveMove> | null;
  /** The 3 winning cell indices once the game is won, else null — highlighted. */
  winningLine?: TicTacToeMoveLine | null;
  /**
   * How the winning-line highlight should read (mirrors TicTacToeBoard): "win"
   * (default, green/success) or "loss" (red/danger).
   */
  winningLineTone?: WinningTone;
}

const SIZE = 3;
const PIECES_PER_PLAYER = 3;

function countMarksOf(board: TicTacToeMoveState["board"], player: Player): number {
  let count = 0;
  for (const cell of board) {
    if (cell === player) count++;
  }
  return count;
}

function cellLabel(mark: 1 | 2 | null, row: number, col: number, selected: boolean): string {
  const position = `Row ${row + 1}, column ${col + 1}`;
  if (mark === 1) return `${position}, X${selected ? ", selected" : ""}`;
  if (mark === 2) return `${position}, O${selected ? ", selected" : ""}`;
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
 * 3x3 board for the Tic-Tac-Toe "Move mode" variant. Each side has exactly 3
 * marks: while the mover has fewer than 3 down, activating an empty cell
 * places one (identical UX to classic Tic-Tac-Toe); once all 3 are down, play
 * becomes a two-step select-then-move — pick one of the mover's own pieces,
 * then an empty cell to relocate it to (any empty cell, not just adjacent).
 *
 * The grid, cell grammar and arrow-key navigation are the shared `BoardGrid`
 * (UI-10). Move mode's own additions are the phase prompt, the two-step
 * selection state, its dashed/dotted modifier classes, and Escape-to-cancel —
 * which it layers on via `onCellKeyDown` rather than by forking the primitive.
 */
export function TicTacToeMoveBoard({
  state,
  onMove,
  disabled,
  lastMove,
  winningLine = null,
  winningLineTone = "win",
}: TicTacToeMoveBoardProps): React.JSX.Element {
  const [selected, setSelected] = useState<number | null>(null);
  const winningCells = winningLine ? new Set<number>(winningLine) : null;

  const mover = state.toMove;
  const marksDown = countMarksOf(state.board, mover);
  const isPlacementPhase = marksDown < PIECES_PER_PLAYER;
  const piecesLeft = PIECES_PER_PLAYER - marksDown;

  const phasePrompt = isPlacementPhase
    ? `${piecesLeft} piece${piecesLeft === 1 ? "" : "s"} left to place.`
    : selected === null
      ? "Select a piece to move."
      : "Choose where to move it — tap it again to cancel.";

  const handleCellKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "Escape" && selected !== null) {
      event.preventDefault();
      setSelected(null);
    }
  };

  const activateCell = (index: number, mark: 1 | 2 | null): void => {
    if (disabled) return;

    if (isPlacementPhase) {
      if (mark !== null) return; // occupied, no-op
      onMove({ kind: "place", cell: index });
      return;
    }

    // Move phase.
    if (selected === null) {
      if (mark !== mover) return; // not the mover's own piece: no-op
      setSelected(index);
      return;
    }

    if (index === selected) {
      setSelected(null); // re-activating the selected piece deselects
      return;
    }

    if (mark === mover) {
      setSelected(index); // selecting a different own piece re-selects
      return;
    }

    if (mark !== null) return; // occupied by the opponent: no-op

    onMove({ kind: "relocate", from: selected, to: index });
    setSelected(null);
  };

  return (
    <div className={styles.wrapper}>
      <p className={styles.prompt}>{phasePrompt}</p>
      <VisuallyHidden>
        <div aria-live="polite" role="status">
          {phasePrompt}
        </div>
      </VisuallyHidden>
      <BoardGrid
        rows={SIZE}
        cols={SIZE}
        label="Tic-Tac-Toe Move mode board"
        disabled={disabled}
        maxWidth="22rem"
        /* The board shares its container with the phase prompt above, so the
           height it can claim is the container's minus that line. */
        heightBudget="calc(100cqh - 3rem)"
        winningTone={winningLineTone}
        onCellKeyDown={handleCellKeyDown}
        cell={(row, col) => {
          const index = row * SIZE + col;
          const mark = (state.board[index] ?? null) as 1 | 2 | null;
          const isEmpty = mark === null;
          const isSelected = selected === index;
          const isOwnPiece = mark === mover;
          const isValidTarget = !isPlacementPhase && selected !== null && isEmpty;
          const isLastMove =
            lastMove !== null &&
            (lastMove.move.kind === "place"
              ? lastMove.move.cell === index
              : lastMove.move.to === index);
          return {
            content: mark ? <Mark mark={mark} /> : null,
            label: cellLabel(mark, row, col, isSelected),
            activatable:
              !disabled &&
              (isPlacementPhase ? isEmpty : selected === null ? isOwnPiece : isOwnPiece || isEmpty),
            lastMove: isLastMove,
            winning: winningCells?.has(index) ?? false,
            pressed: !isPlacementPhase && isOwnPiece ? isSelected : undefined,
            className: cx(isSelected && styles.selected, isValidTarget && styles.validTarget),
          };
        }}
        onActivate={(row, col) => {
          const index = row * SIZE + col;
          activateCell(index, (state.board[index] ?? null) as 1 | 2 | null);
        }}
      />
    </div>
  );
}
