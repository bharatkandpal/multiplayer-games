import {
  findClothesColor,
  findHairColor,
  findShoeColor,
  findSkinTone,
  type DrunkWalkCharacter,
} from "./drunkWalkCharacter";

export interface DrunkWalkCharacterGlyphProps {
  character: DrunkWalkCharacter;
  /** CSS pixel size (square). Default suits a menu swatch button. */
  size?: number;
}

const BEARD_COLOR = "#3a2a1a";

/**
 * A small static SVG "how it would look" preview of a Drunk Walk character —
 * used both as the customize menu's headline preview (current picks, larger)
 * and inside every option button (that option applied on top of the current
 * picks, small), so every choice shows the actual character instead of a
 * name/color chip. Deliberately NOT the in-game Canvas renderer: this is a
 * simple standing SVG doll (no lean, no gait, no scene) — a lighter, DPR-free
 * way to render dozens of small instances in a menu, at the cost of not being
 * pixel-identical to the play surface's figure. Purely presentational; reads
 * the same character data `DrunkWalkScene` does, never writes it.
 */
export function DrunkWalkCharacterGlyph({
  character,
  size = 56,
}: DrunkWalkCharacterGlyphProps): React.JSX.Element {
  const clothes = findClothesColor(character.clothesId);
  const shoes = findShoeColor(character.shoesId);
  const skin = findSkinTone(character.skinId);
  const hair = findHairColor(character.hairColorId);
  // "classic" stays theme-aware (via the CSS custom property) exactly like
  // the in-game renderer's special-case for it; every other color is a fixed
  // swatch value regardless of theme, same convention as `DrunkWalkScene`.
  const tone = clothes.id === "classic" ? "var(--color-warning, #ffd23f)" : clothes.tone;
  const shade = clothes.id === "classic" ? "var(--color-warning-text, #9a5b00)" : clothes.shade;

  return (
    // viewBox starts above y=0 (not "0 0 60 100") so the party-hat/halo
    // glyphs, which sit above the head, aren't clipped — an SVG root clips
    // to its viewBox by default (unlike a plain <div>, where overflowing
    // content just spills visibly).
    <svg viewBox="0 -16 60 116" width={size} height={size} aria-hidden="true">
      {/* Arms. */}
      <rect x="7" y="38" width="7" height="22" rx="3.5" fill={shade} />
      <rect x="46" y="38" width="7" height="22" rx="3.5" fill={shade} />
      {/* Hands — skin-toned, matching the in-game renderer. */}
      <circle cx="10.5" cy="61" r="3.6" fill={skin.tone} />
      <circle cx="49.5" cy="61" r="3.6" fill={skin.tone} />
      {/* Legs. */}
      <rect x="19" y="62" width="9" height="24" rx="3" fill={tone} />
      <rect x="32" y="62" width="9" height="24" rx="3" fill={tone} />
      {/* Shoes. */}
      <ellipse cx="23.5" cy="88" rx="7.5" ry="4" fill={shoes.tone} />
      <ellipse cx="36.5" cy="88" rx="7.5" ry="4" fill={shoes.tone} />
      {/* Torso. */}
      <rect x="15" y="34" width="30" height="30" rx="11" fill={tone} />
      {/* Head. */}
      <circle cx="30" cy="20" r="14" fill={skin.tone} />
      <DrunkWalkHairGlyph hair={character.hair} tone={hair.tone} shade={hair.shade} />
      <DrunkWalkBeardGlyph beard={character.beard} />
      <DrunkWalkAccessoryGlyph accessory={character.accessory} />
      <DrunkWalkHatGlyph hat={character.hat} tone={tone} shade={shade} />
    </svg>
  );
}

function DrunkWalkHairGlyph({
  hair,
  tone,
  shade,
}: {
  hair: DrunkWalkCharacter["hair"];
  tone: string;
  shade: string;
}): React.JSX.Element | null {
  if (hair === "none") return null;

  if (hair === "short") {
    return <path d="M16 14 A14 14 0 0 1 44 14 Z" fill={shade} />;
  }

  if (hair === "long") {
    return (
      <g fill={shade}>
        <path d="M16 14 A14 14 0 0 1 44 14 Z" />
        <path d="M15 12 Q9 26 13 38 L19 36 Q14 24 18 10 Z" />
        <path d="M45 12 Q51 26 47 38 L41 36 Q46 24 42 10 Z" />
      </g>
    );
  }

  if (hair === "bun") {
    return (
      <g fill={shade}>
        <path d="M16 14 A14 14 0 0 1 44 14 Z" />
        <circle cx="15" cy="9" r="4.6" />
      </g>
    );
  }

  // Mohawk — a bright tip on each spike, same "loud, not natural" treatment
  // as the in-game Canvas renderer.
  return (
    <g>
      <path d="M22 8 L26 -2 L30 6 L34 -2 L38 8 Z" fill={shade} />
      <circle cx="26" cy="-2" r="1.6" fill={tone} />
      <circle cx="34" cy="-2" r="1.6" fill={tone} />
    </g>
  );
}

function DrunkWalkAccessoryGlyph({
  accessory,
}: {
  accessory: DrunkWalkCharacter["accessory"];
}): React.JSX.Element | null {
  if (accessory === "none") return null;

  if (accessory === "glasses" || accessory === "sunglasses") {
    const lensFill = accessory === "sunglasses" ? "#20242bcc" : "#bfe0ff55";
    return (
      <g stroke="#20242b" strokeWidth="1.4" fill={lensFill}>
        <ellipse cx="24" cy="19" rx="5" ry="4.2" />
        <ellipse cx="36" cy="19" rx="5" ry="4.2" />
        <line x1="29" y1="19" x2="31" y2="19" />
      </g>
    );
  }

  // Headphones.
  return (
    <g fill="none" stroke="#2b2b30" strokeWidth="3">
      <path d="M17 18 A13 13 0 0 1 43 18" />
      <circle cx="17" cy="21" r="4" fill="#2b2b30" />
      <circle cx="43" cy="21" r="4" fill="#2b2b30" />
    </g>
  );
}

function DrunkWalkBeardGlyph({
  beard,
}: {
  beard: DrunkWalkCharacter["beard"];
}): React.JSX.Element | null {
  if (beard === "none") return null;

  if (beard === "mustache") {
    return (
      <g fill={BEARD_COLOR}>
        <ellipse cx="24" cy="24" rx="4.5" ry="2.2" transform="rotate(-15 24 24)" />
        <ellipse cx="36" cy="24" rx="4.5" ry="2.2" transform="rotate(15 36 24)" />
      </g>
    );
  }

  if (beard === "goatee") {
    return <path d="M23 24 L37 24 L34 34 L26 34 Z" fill={BEARD_COLOR} />;
  }

  // Full beard: the lower half of the head circle.
  return <path d="M17 20 A14 14 0 0 0 43 20 A16 16 0 0 1 17 20 Z" fill={BEARD_COLOR} />;
}

function DrunkWalkHatGlyph({
  hat,
  tone,
  shade,
}: {
  hat: DrunkWalkCharacter["hat"];
  tone: string;
  shade: string;
}): React.JSX.Element | null {
  if (hat === "none") return null;

  if (hat === "cap") {
    return (
      <g>
        <path d="M16 12 A14 14 0 0 1 44 12 Z" fill={shade} />
        <ellipse cx="41" cy="12" rx="7" ry="2.6" fill={shade} />
      </g>
    );
  }

  if (hat === "party-hat") {
    return (
      <g>
        <path d="M20 8 L40 8 L30 -10 Z" fill={tone} />
        <circle cx="30" cy="-10" r="3" fill="#ffffff" />
      </g>
    );
  }

  // Halo.
  return (
    <g>
      <ellipse cx="30" cy="-2" rx="11" ry="3.5" fill="none" stroke={tone} strokeWidth="2.4" />
      <text x="44" y="4" fontSize="8" fill={tone}>
        ✦
      </text>
    </g>
  );
}
