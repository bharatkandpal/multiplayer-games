import { DrunkWalkCharacterGlyph } from "./DrunkWalkCharacterGlyph";
import {
  DRUNK_WALK_COSMETICS,
  characterFromConfig,
  type DrunkWalkCharacter,
} from "./drunkWalkCharacter";
import type { CosmeticConfig, CosmeticSlot } from "../../cosmetics";
import { Modal } from "../ui";
import styles from "./DrunkWalkCustomizeMenu.module.css";

export interface DrunkWalkCustomizeMenuProps {
  isOpen: boolean;
  character: DrunkWalkCharacter;
  onChange: (character: DrunkWalkCharacter) => void;
  onClose: () => void;
}

/**
 * Character customization for Drunk Walk — opened from a cog button overlaid
 * on the play surface (available any time, not just before a run) rather
 * than living inline on the ready overlay: eight independent, mix-and-match
 * parts (skin tone / hair style / hair color / beard / accessory / hat /
 * clothes color / shoe color) is more than a single row of swatches can
 * hold, and a modal keeps the play surface uncluttered. Enough independent
 * axes that a player can approximate their own look — or a caricature of
 * someone else's — without any photo/AI pipeline. Purely cosmetic — never
 * read by the engine.
 *
 * Every option shows the character wearing it (via `DrunkWalkCharacterGlyph`)
 * rather than a name or a bare color chip — "show, don't tell" for a purely
 * visual choice — plus a larger headline preview of the current full combo
 * at the top so picks are visible immediately, not just per-option.
 *
 * Since MPG-088-b the sections are DERIVED from the registered schema rather
 * than hand-listed: adding a slot or an option to `DRUNK_WALK_COSMETICS` shows
 * up here with no change to this file. The section order is the schema's slot
 * order, which is why the schema lists skin → hair → hair colour → beard →
 * accessory → hat → clothes → shoes: roughly bottom-up on the body, and
 * unchanged from what shipped.
 */
export function DrunkWalkCustomizeMenu({
  isOpen,
  character,
  onChange,
  onClose,
}: DrunkWalkCustomizeMenuProps): React.JSX.Element {
  const config = character as unknown as CosmeticConfig;

  const selectOption = (slotId: string, optionId: string): void => {
    onChange(characterFromConfig({ ...config, [slotId]: optionId }));
  };

  return (
    <Modal isOpen={isOpen} title="Customize character" onClose={onClose}>
      <div className={styles.menu}>
        <div className={styles.preview}>
          <DrunkWalkCharacterGlyph character={character} size={96} />
        </div>

        {DRUNK_WALK_COSMETICS.slots.map((slot) => (
          <SlotSection
            key={slot.id}
            slot={slot}
            selectedId={config[slot.id] ?? ""}
            previewFor={(optionId) => characterFromConfig({ ...config, [slot.id]: optionId })}
            onSelect={(optionId) => selectOption(slot.id, optionId)}
          />
        ))}
      </div>
    </Modal>
  );
}

/**
 * One cosmetic slot, shown as a row of buttons that each render the FULL
 * character with that one option applied (via `previewFor`) — so every button
 * already answers "how would it look", not just the selected one at the top.
 * `name` is still supplied (as `title`/`aria-label`) so the pick isn't
 * visual-only for assistive tech.
 */
function SlotSection({
  slot,
  selectedId,
  previewFor,
  onSelect,
}: {
  slot: CosmeticSlot;
  selectedId: string;
  previewFor: (optionId: string) => DrunkWalkCharacter;
  onSelect: (optionId: string) => void;
}): React.JSX.Element {
  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionLabel}>{slot.label}</legend>
      {/* No `role="group"`/`aria-label` here: the <fieldset> is already a group
          named by its <legend>, and the pair announced the label twice. */}
      <div className={styles.optionRow}>
        {slot.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={styles.option}
            aria-pressed={opt.id === selectedId}
            aria-label={opt.name}
            title={opt.name}
            data-selected={opt.id === selectedId || undefined}
            onClick={() => onSelect(opt.id)}
          >
            <DrunkWalkCharacterGlyph character={previewFor(opt.id)} size={44} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
