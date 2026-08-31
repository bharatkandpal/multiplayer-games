import { ENGINE_VERSION, connectFour, nim, ticTacToe, ticTacToeMove } from "@mpg/engine";
import type { GameId, RealtimeGameId } from "@mpg/engine";
import { Button } from "../components/ui";
import { GameThumbnail } from "./gameThumbnails";
import styles from "./HomeScreen.module.css";

/**
 * The two game families coexist in one catalog (ADR 0002 §2): `turn-based`
 * (seat setup → turns) and `realtime` (solo arcade, no seats). Home shows both
 * in a single grid, tagged by `kind`, and the App router branches on it.
 */
export type GameKind = "turn-based" | "realtime";

export interface GameCatalogEntry {
  readonly id: GameId;
  readonly title: string;
  readonly description: string;
  /** Number of seats the game supports (`GameModule.playerCount`) — drives seat setup (MPG-024). */
  readonly playerCount: number;
  readonly kind: "turn-based";
}

export interface RealtimeCatalogEntry {
  readonly id: RealtimeGameId;
  readonly title: string;
  readonly description: string;
  readonly kind: "realtime";
}

// Partial, not exhaustive: a game can exist in the engine registry before it's
// surfaced in the UI (e.g. a new variant whose board/route land in a later task).
// Home only shows games that have a catalog entry (see filter below).
export const GAME_CATALOG: Partial<Record<GameId, GameCatalogEntry>> = {
  tictactoe: {
    id: "tictactoe",
    title: "Tic-Tac-Toe",
    description: "Classic 3x3. Quick games, easy to teach a bot to play well.",
    playerCount: ticTacToe.playerCount,
    kind: "turn-based",
  },
  connect4: {
    id: "connect4",
    title: "Connect Four",
    description: "Drop discs, connect four in a row. 7 columns, 6 rows.",
    playerCount: connectFour.playerCount,
    kind: "turn-based",
  },
  "tictactoe-move": {
    id: "tictactoe-move",
    title: "Move-Mode Tic-Tac-Toe",
    description:
      "Only 3 pieces each — place them, then move one to any empty square per turn. Get three in a row to win (no draws by filling up, but repeating the same position three times is a draw).",
    playerCount: ticTacToeMove.playerCount,
    kind: "turn-based",
  },
  nim: {
    id: "nim",
    title: "Nim",
    description:
      "Take turns removing objects from piles — whoever takes the last object wins. Simple rules, deep strategy.",
    playerCount: nim.playerCount,
    kind: "turn-based",
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
  },
  "drunk-walk": {
    id: "drunk-walk",
    title: "Drunk Walk",
    description:
      "Balance a wobbly walker down an endless path. Tap the side opposite your lean to correct it — the wrong side makes it worse.",
    kind: "realtime",
  },
};

/** A single card in the unified Home grid, discriminated by family. */
type HomeItem =
  | { readonly kind: "turn-based"; readonly id: GameId; readonly title: string }
  | { readonly kind: "realtime"; readonly id: RealtimeGameId; readonly title: string };

export interface HomeScreenProps {
  /** Registered turn-based ids (from `listGames()`) — home never hardcodes the catalog. */
  games: GameId[];
  /** Registered real-time ids (from `listRealtimeGames()`). */
  realtimeGames?: RealtimeGameId[];
  onSelectGame: (gameId: GameId) => void;
  onSelectRealtimeGame?: (gameId: RealtimeGameId) => void;
  onShowGallery: () => void;
}

/**
 * Landing screen: pick a game to play. One clear primary action per card
 * (UX_PRINCIPLES §1.6) — selecting a game moves straight to seat setup.
 */
export function HomeScreen({
  games,
  realtimeGames = [],
  onSelectGame,
  onSelectRealtimeGame,
  onShowGallery,
}: HomeScreenProps): React.JSX.Element {
  // The unified grid (ADR 0002 §2/§3): both registries, tagged by kind, showing
  // only ids that have a catalog entry (title/route wiring exists). Turn-based
  // first so existing card order is unchanged; real-time games follow.
  const items: HomeItem[] = [
    ...games.flatMap((id): HomeItem[] => {
      const entry = GAME_CATALOG[id];
      return entry ? [{ kind: "turn-based", id, title: entry.title }] : [];
    }),
    ...realtimeGames.flatMap((id): HomeItem[] => {
      const entry = REALTIME_CATALOG[id];
      return entry ? [{ kind: "realtime", id, title: entry.title }] : [];
    }),
  ];

  return (
    <div className={styles.main}>
      <h1 className={styles.heading}>Multiplayer Games</h1>
      <p className={styles.tagline}>
        Pick a game, choose who&apos;s playing — human or bot, any mix — and start playing right in
        your browser.
      </p>

      <h2 className={styles.sectionHeading}>Choose a game</h2>
      {items.length === 0 ? (
        <p className={styles.empty}>
          No games are available right now. Try reloading the page — if that doesn&apos;t help, this
          is a bug, not something you did.
        </p>
      ) : (
        <ul className={styles.gameGrid} aria-label="Available games">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <button
                type="button"
                className={styles.gameCard}
                onClick={() =>
                  item.kind === "realtime" ? onSelectRealtimeGame?.(item.id) : onSelectGame(item.id)
                }
              >
                <span className={styles.gameThumbnail}>
                  <GameThumbnail gameId={item.id} />
                </span>
                <span className={styles.gameTitle}>{item.title}</span>
                {item.kind === "realtime" ? (
                  <span className={styles.gameKindTag}>Solo arcade</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className={styles.footer}>
        <p>
          Engine version: <code>{ENGINE_VERSION}</code>
        </p>
        <div className={styles.footerLink}>
          <Button variant="ghost" size="sm" onClick={onShowGallery}>
            View design-system kit
          </Button>
        </div>
      </footer>
    </div>
  );
}
