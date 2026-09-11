import { GAME_2048_SIZES, type Game2048Size } from "@mpg/engine";
import { Modal } from "../ui";
import styles from "./Game2048CustomizeMenu.module.css";

export interface Game2048CustomizeMenuProps {
  isOpen: boolean;
  size: Game2048Size;
  onChange: (size: Game2048Size) => void;
  onClose: () => void;
}

const SIZE_HINT: Record<Game2048Size, string> = {
  3: "Small and fast — the board fills quickly",
  4: "Classic 2048",
  5: "Roomy — longer runs, more room to plan",
};

/**
 * Board-size picker for 2048 (MPG-096) — opened from a cog on the play surface,
 * mirroring Drunk Walk's customize menu. Three sizes (3×3 / 4×4 / 5×5); each is a
 * different game with its own leaderboard (ADR 0007 §5), so the note spells out
 * that changing size starts a fresh run. Each option shows an actual grid glyph
 * of that size ("show, don't tell") with the dimension and a one-line hint, and a
 * plain-language `aria-label` so the choice isn't visual-only for assistive tech.
 */
export function Game2048CustomizeMenu({
  isOpen,
  size,
  onChange,
  onClose,
}: Game2048CustomizeMenuProps): React.JSX.Element {
  return (
    <Modal isOpen={isOpen} title="Board size" onClose={onClose}>
      <fieldset className={styles.section}>
        <legend className={styles.sectionLabel}>Grid size</legend>
        <div className={styles.optionRow}>
          {GAME_2048_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.option}
              aria-pressed={s === size}
              aria-label={`${s} by ${s} grid — ${SIZE_HINT[s]}`}
              data-selected={s === size || undefined}
              onClick={() => onChange(s)}
            >
              <GridGlyph size={s} />
              <span className={styles.optionLabel}>
                {s}×{s}
              </span>
              <span className={styles.optionHint}>{SIZE_HINT[s]}</span>
            </button>
          ))}
        </div>
        <p className={styles.note}>
          Each size has its own leaderboard. Changing the size starts a new game.
        </p>
      </fieldset>
    </Modal>
  );
}

/** A decorative `size × size` grid of cells previewing the board shape. */
function GridGlyph({ size }: { size: Game2048Size }): React.JSX.Element {
  return (
    <span
      className={styles.glyph}
      style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
      aria-hidden="true"
    >
      {Array.from({ length: size * size }, (_, i) => (
        <span key={i} className={styles.glyphCell} />
      ))}
    </span>
  );
}
