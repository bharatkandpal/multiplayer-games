import { DrunkWalkCharacterGlyph } from "./DrunkWalkCharacterGlyph";
import {
  DRUNK_WALK_ACCESSORIES,
  DRUNK_WALK_BEARDS,
  DRUNK_WALK_CLOTHES_COLORS,
  DRUNK_WALK_HAIR_COLORS,
  DRUNK_WALK_HAIRSTYLES,
  DRUNK_WALK_HATS,
  DRUNK_WALK_SHOE_COLORS,
  DRUNK_WALK_SKIN_TONES,
  type DrunkWalkCharacter,
} from "./drunkWalkCharacter";
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
 */
export function DrunkWalkCustomizeMenu({
  isOpen,
  character,
  onChange,
  onClose,
}: DrunkWalkCustomizeMenuProps): React.JSX.Element {
  return (
    <Modal isOpen={isOpen} title="Customize character" onClose={onClose}>
      <div className={styles.menu}>
        <div className={styles.preview}>
          <DrunkWalkCharacterGlyph character={character} size={96} />
        </div>

        <PartSection
          label="Skin tone"
          options={DRUNK_WALK_SKIN_TONES}
          selectedId={character.skinId}
          previewFor={(skinId) => ({ ...character, skinId })}
          onSelect={(skinId) => onChange({ ...character, skinId })}
        />
        <PartSection
          label="Hair"
          options={DRUNK_WALK_HAIRSTYLES}
          selectedId={character.hair}
          previewFor={(hair) => ({ ...character, hair })}
          onSelect={(hair) => onChange({ ...character, hair })}
        />
        <PartSection
          label="Hair color"
          options={DRUNK_WALK_HAIR_COLORS}
          selectedId={character.hairColorId}
          previewFor={(hairColorId) => ({ ...character, hairColorId })}
          onSelect={(hairColorId) => onChange({ ...character, hairColorId })}
        />
        <PartSection
          label="Beard"
          options={DRUNK_WALK_BEARDS}
          selectedId={character.beard}
          previewFor={(beard) => ({ ...character, beard })}
          onSelect={(beard) => onChange({ ...character, beard })}
        />
        <PartSection
          label="Accessory"
          options={DRUNK_WALK_ACCESSORIES}
          selectedId={character.accessory}
          previewFor={(accessory) => ({ ...character, accessory })}
          onSelect={(accessory) => onChange({ ...character, accessory })}
        />
        <PartSection
          label="Hat"
          options={DRUNK_WALK_HATS}
          selectedId={character.hat}
          previewFor={(hat) => ({ ...character, hat })}
          onSelect={(hat) => onChange({ ...character, hat })}
        />
        <PartSection
          label="Clothes"
          options={DRUNK_WALK_CLOTHES_COLORS}
          selectedId={character.clothesId}
          previewFor={(clothesId) => ({ ...character, clothesId })}
          onSelect={(clothesId) => onChange({ ...character, clothesId })}
        />
        <PartSection
          label="Shoes"
          options={DRUNK_WALK_SHOE_COLORS}
          selectedId={character.shoesId}
          previewFor={(shoesId) => ({ ...character, shoesId })}
          onSelect={(shoesId) => onChange({ ...character, shoesId })}
        />
      </div>
    </Modal>
  );
}

/**
 * One customization category, shown as a row of buttons that each render the
 * FULL character with that one option applied (via `previewFor`) — so every
 * button already answers "how would it look", not just the selected one at
 * the top. Generic over the option id type (`DrunkWalkHat`/`DrunkWalkBeard`/
 * plain color-id `string`) so it covers all four categories with one
 * component. `name` is still supplied (as `title`/`aria-label`) so the pick
 * isn't visual-only for assistive tech.
 */
function PartSection<T extends string>({
  label,
  options,
  selectedId,
  previewFor,
  onSelect,
}: {
  label: string;
  options: readonly { readonly id: T; readonly name: string }[];
  selectedId: T;
  previewFor: (id: T) => DrunkWalkCharacter;
  onSelect: (id: T) => void;
}): React.JSX.Element {
  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionLabel}>{label}</legend>
      <div className={styles.optionRow} role="group" aria-label={label}>
        {options.map((opt) => (
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
