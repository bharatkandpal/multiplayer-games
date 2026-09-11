/**
 * What a card renderer is allowed to see.
 *
 * An **allowlist**, mirroring the discipline `share/shareRoutes.ts` applies to
 * `toPublicResult`: a card is the most public artifact this system produces — it is
 * rendered into an image, cached forever, and scraped by services that will re-host it.
 * So renderers are handed a narrow shape that simply does not contain `ownerToken` (an
 * identity credential) or `moveLog` (the replay — and, for a turn-based game, the
 * spoiler). A new column on `game_results` cannot silently start appearing on cards.
 *
 * A `GameResult` is structurally assignable to this, so MPG-085-b can pass one straight
 * in without a mapper, and still cannot widen what a renderer can reach.
 */
export interface ResultCardInput {
  readonly gameId: string;
  /** `"turn-based"` or `"realtime"` — picks the card's ground (cabinet vs table). */
  readonly gameFamily: string;
  /** The engine's terminal status for turn-based rows; `"complete"` for real-time. */
  readonly status: string;
  /** Real-time games rank on this; `null` for turn-based. */
  readonly score: number | null;
  /** 1-based winning seat, or `null` on a draw / a scored game. */
  readonly winnerSlot: number | null;
  /** Seat composition, for describing the opponent. Shape-checked, never trusted. */
  readonly seatsSnapshot: unknown;
  readonly durationMs: number | null;
  readonly createdAt: Date;
}

/** A pure card renderer: same input, byte-identical SVG out. No I/O, no clock, no RNG. */
export type CardRenderer = (result: ResultCardInput) => string;

/** One seat as the card may describe it, after shape-checking `seatsSnapshot`. */
export interface CardSeat {
  readonly slot: number;
  readonly kind: "human" | "bot";
}

/**
 * Reads `seatsSnapshot` defensively.
 *
 * The column is `jsonb` and holds whatever was written when the row was created — rows
 * predating `results/resultRoutes.ts`'s sanitisation included. A card that throws on an
 * unexpected shape would take down the unfurl for an otherwise perfectly good result,
 * so anything unrecognised simply yields no seats and the card omits its opponent line.
 */
export function readSeats(snapshot: unknown): CardSeat[] {
  if (!Array.isArray(snapshot)) return [];
  const seats: CardSeat[] = [];
  for (const item of snapshot) {
    if (typeof item !== "object" || item === null) return [];
    const seat = item as Record<string, unknown>;
    const slot = seat["slot"];
    const kind = seat["kind"];
    if (typeof slot !== "number" || (kind !== "human" && kind !== "bot")) return [];
    seats.push({ slot, kind });
  }
  return seats;
}
