// The UI-side game catalog and the ordering used to walk between games.
//
// Split out of `HomeScreen` (rather than left there) because Home is no longer
// the only screen that needs the catalog: the "next game" control on the play
// surfaces walks the same ordered list, and importing HomeScreen from a play
// screen would pull the whole landing page into that bundle — and create an
// import cycle. `HomeScreen` re-exports the catalog values so existing importers
// (and the `vi.mock("./HomeScreen")` in SetupScreen.nSeat.test.tsx) keep working.

import { connectFour, gomoku, nim, ticTacToe, ticTacToeMove } from "@mpg/engine";
import type { GameId, RealtimeGameId } from "@mpg/engine";

/**
 * The two game families coexist in one catalog (ADR 0002 §2): `turn-based`
 * (seat setup → turns) and `realtime` (solo arcade, no seats). Home shows both
 * in a single grid, tagged by `kind`, and the App router branches on it.
 */
export type GameKind = "turn-based" | "realtime";

/**
 * Player-facing facets (UI-3), deliberately orthogonal to `kind`.
 *
 * `kind` is architectural — it decides which router branch a game takes and
 * whether it has seats at all. `tags` are how a *player* scans the shelf:
 * "can I play this with someone?", "is this a two-minute thing?".
 *
 * The seat-count tags (`solo` / `2-player` / `multiplayer`) are NEVER authored
 * on an entry — `gameTags()` derives them from `playerCount`, so a catalog
 * entry can't drift into claiming something the engine contradicts. Author
 * only the tags below that aren't derivable from data we already hold.
 */
export type GameTag =
  /** Derived — one seat, no opponent. */
  | "solo"
  /** Derived — exactly two seats. */
  | "2-player"
  /** Derived — three or more seats (ADR: never hardcode 2). */
  | "multiplayer"
  /** A bot can take a seat. */
  | "vs-bot"
  /** Can be played over a shareable room link. */
  | "online"
  /** Supports an all-bot room you can spectate. */
  | "watch"
  /** Typically over in under a minute. */
  | "quick"
  /** No win condition — you're chasing a score. */
  | "endless";

/** The subset of `GameTag` an entry may author (the rest are derived). */
export type AuthoredGameTag = Exclude<GameTag, "solo" | "2-player" | "multiplayer">;

export interface GameCatalogEntry {
  readonly id: GameId;
  readonly title: string;
  readonly description: string;
  /** Number of seats the game supports (`GameModule.playerCount`) — drives seat setup (MPG-024). */
  readonly playerCount: number;
  readonly kind: "turn-based";
  readonly tags: readonly AuthoredGameTag[];
}

export interface RealtimeCatalogEntry {
  readonly id: RealtimeGameId;
  readonly title: string;
  readonly description: string;
  readonly kind: "realtime";
  readonly tags: readonly AuthoredGameTag[];
}

// Partial, not exhaustive: a game can exist in the engine registry before it's
// surfaced in the UI (e.g. a new variant whose board/route land in a later task).
// Home only shows games that have a catalog entry (see `buildGameItems`).
export const GAME_CATALOG: Partial<Record<GameId, GameCatalogEntry>> = {
  tictactoe: {
    id: "tictactoe",
    title: "Tic-Tac-Toe",
    description: "Classic 3x3. Quick games, easy to teach a bot to play well.",
    playerCount: ticTacToe.playerCount,
    kind: "turn-based",
    tags: ["vs-bot", "online", "watch", "quick"],
  },
  connect4: {
    id: "connect4",
    title: "Connect Four",
    description: "Drop discs, connect four in a row. 7 columns, 6 rows.",
    playerCount: connectFour.playerCount,
    kind: "turn-based",
    tags: ["vs-bot", "online", "watch"],
  },
  "tictactoe-move": {
    id: "tictactoe-move",
    title: "Move-Mode Tic-Tac-Toe",
    description:
      "Only 3 pieces each — place them, then move one to any empty square per turn. Get three in a row to win (no draws by filling up, but repeating the same position three times is a draw).",
    playerCount: ticTacToeMove.playerCount,
    kind: "turn-based",
    tags: ["vs-bot", "online", "watch"],
  },
  nim: {
    id: "nim",
    title: "Nim",
    description:
      "Take turns removing objects from piles — whoever takes the last object wins. Simple rules, deep strategy.",
    playerCount: nim.playerCount,
    kind: "turn-based",
    tags: ["vs-bot", "online", "watch", "quick"],
  },
  gomoku: {
    id: "gomoku",
    title: "Gomoku",
    description:
      "Place stones on a 9x9 board and be the first to line up five in a row — across, down, or diagonally.",
    playerCount: gomoku.playerCount,
    kind: "turn-based",
    tags: ["vs-bot", "online", "watch"],
  },
};

// Sibling of GAME_CATALOG for the real-time family (ADR 0002 §3). Also Partial —
// `RealtimeGameId` includes `lumberjack` (MPG-041), not built yet.
export const REALTIME_CATALOG: Partial<Record<RealtimeGameId, RealtimeCatalogEntry>> = {
  "floppy-birds": {
    id: "floppy-birds",
    title: "Floppy Birds",
    description:
      "Tap to flap and thread the bird through the pipes. One player, one life — chase a high score.",
    kind: "realtime",
    tags: ["endless"],
  },
  "drunk-walk": {
    id: "drunk-walk",
    title: "Drunk Walk",
    description:
      "Balance a wobbly walker down an endless path. Tap the side opposite your lean to correct it — the wrong side makes it worse.",
    kind: "realtime",
    tags: ["endless"],
  },
  "reflex-test": {
    id: "reflex-test",
    title: "Reflex Test",
    description:
      "Wait for red to turn green, then tap as fast as you can. Five rounds — see your best and average reaction time. Tap too early and the run is over.",
    kind: "realtime",
    tags: ["quick"],
  },
  "2048": {
    id: "2048",
    title: "2048",
    description:
      "Swipe to slide the tiles — equal ones merge and double. Keep going until the board fills up. Chase the biggest number and the highest score.",
    kind: "realtime",
    tags: ["endless"],
  },
  breakout: {
    id: "breakout",
    title: "Breakout",
    description:
      "Bounce the ball off your paddle to smash the wall of bricks. Clear it and a faster wall drops in. Three lives — how high can you score?",
    kind: "realtime",
    tags: ["endless"],
  },
};

/**
 * The full tag list for an entry: the derived seat-count tag first, then the
 * authored ones in catalog order.
 *
 * The seat tag is computed rather than written down so it can never contradict
 * `playerCount` — and so a future three-seat game is classified correctly
 * without anyone revisiting the catalog. Real-time games have no seats at all
 * (ADR 0002 §3), which is what makes them `solo`.
 *
 * Callers get a plain mutable array back; the catalog's own `tags` stay
 * `readonly`.
 */
export function gameTags(entry: GameCatalogEntry | RealtimeCatalogEntry): GameTag[] {
  return [seatTag(entry), ...entry.tags];
}

/** The one tag derived from seat count rather than authored. */
function seatTag(entry: GameCatalogEntry | RealtimeCatalogEntry): GameTag {
  if (entry.kind === "realtime") return "solo";
  if (entry.playerCount <= 1) return "solo";
  return entry.playerCount === 2 ? "2-player" : "multiplayer";
}

/** True when `entry` carries `tag` — the predicate a tag filter is built on. */
export function hasTag(entry: GameCatalogEntry | RealtimeCatalogEntry, tag: GameTag): boolean {
  return gameTags(entry).includes(tag);
}

/** A single entry in the ordered game list, discriminated by family. */
export type GameItem =
  | { readonly kind: "turn-based"; readonly id: GameId; readonly title: string }
  | { readonly kind: "realtime"; readonly id: RealtimeGameId; readonly title: string };

/**
 * The canonical ordered list of playable games: both registries, tagged by
 * kind, filtered to ids that actually have a catalog entry (title/route wiring
 * exists). Turn-based first, then real-time.
 *
 * This one ordering backs both the Home grid and the prev/next controls, so a
 * game can never appear in one and not the other. The filter is what kept
 * Gomoku unreachable while its engine was on the trunk without a catalog entry
 * (MPG-107, since fixed) — a game still in `builtInGames` but absent from
 * `GAME_CATALOG` is correctly hidden rather than half-shown.
 */
export function buildGameItems(games: GameId[], realtimeGames: RealtimeGameId[] = []): GameItem[] {
  return [
    ...games.flatMap((id): GameItem[] => {
      const entry = GAME_CATALOG[id];
      return entry ? [{ kind: "turn-based", id, title: entry.title }] : [];
    }),
    ...realtimeGames.flatMap((id): GameItem[] => {
      const entry = REALTIME_CATALOG[id];
      return entry ? [{ kind: "realtime", id, title: entry.title }] : [];
    }),
  ];
}

/** Index of `gameId` within `items`, or `-1` when it isn't a listed game. */
export function indexOfGame(items: GameItem[], gameId: GameId | RealtimeGameId): number {
  return items.findIndex((item) => item.id === gameId);
}

/**
 * The game `offset` steps away from `gameId`, wrapping around both ends so
 * "next" from the last game returns to the first and there is never a dead
 * control. Returns `undefined` when `gameId` isn't listed, or when the list has
 * fewer than two games (nothing to move to).
 */
export function relativeGame(
  items: GameItem[],
  gameId: GameId | RealtimeGameId,
  offset: number,
): GameItem | undefined {
  if (items.length < 2) return undefined;
  const current = indexOfGame(items, gameId);
  if (current === -1) return undefined;
  // `%` keeps a negative result negative in JS, so bias by `items.length`
  // before the final modulo to make -1 wrap to the last game rather than
  // indexing off the front of the array.
  const target = (((current + offset) % items.length) + items.length) % items.length;
  return items[target];
}

/** The game after `gameId`, wrapping to the first. */
export function nextGame(items: GameItem[], gameId: GameId | RealtimeGameId): GameItem | undefined {
  return relativeGame(items, gameId, 1);
}

/** The game before `gameId`, wrapping to the last. */
export function prevGame(items: GameItem[], gameId: GameId | RealtimeGameId): GameItem | undefined {
  return relativeGame(items, gameId, -1);
}
