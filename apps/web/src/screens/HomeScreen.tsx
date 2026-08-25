import { ENGINE_VERSION, connectFour, ticTacToe } from "@mpg/engine";
import type { GameId } from "@mpg/engine";
import { Button } from "../components/ui";
import styles from "./HomeScreen.module.css";

export interface GameCatalogEntry {
  readonly id: GameId;
  readonly title: string;
  readonly description: string;
  /** Number of seats the game supports (`GameModule.playerCount`) — drives seat setup (MPG-024). */
  readonly playerCount: number;
}

export const GAME_CATALOG: Record<GameId, GameCatalogEntry> = {
  tictactoe: {
    id: "tictactoe",
    title: "Tic-Tac-Toe",
    description: "Classic 3x3. Quick games, easy to teach a bot to play well.",
    playerCount: ticTacToe.playerCount,
  },
  connect4: {
    id: "connect4",
    title: "Connect Four",
    description: "Drop discs, connect four in a row. 7 columns, 6 rows.",
    playerCount: connectFour.playerCount,
  },
};

export interface HomeScreenProps {
  /** Registered game ids (from `listGames()`) — home never hardcodes the catalog. */
  games: GameId[];
  onSelectGame: (gameId: GameId) => void;
  onShowGallery: () => void;
}

/**
 * Landing screen: pick a game to play. One clear primary action per card
 * (UX_PRINCIPLES §1.6) — selecting a game moves straight to seat setup.
 */
export function HomeScreen({
  games,
  onSelectGame,
  onShowGallery,
}: HomeScreenProps): React.JSX.Element {
  return (
    <div className={styles.main}>
      <h1 className={styles.heading}>Multiplayer Games</h1>
      <p className={styles.tagline}>
        Pick a game, choose who&apos;s playing — human or bot, any mix — and start playing right in
        your browser.
      </p>

      <h2 className={styles.sectionHeading}>Choose a game</h2>
      {games.length === 0 ? (
        <p className={styles.empty}>
          No games are available right now. Try reloading the page — if that doesn&apos;t help, this
          is a bug, not something you did.
        </p>
      ) : (
        <ul className={styles.gameGrid} aria-label="Available games">
          {games.map((id) => {
            const entry = GAME_CATALOG[id];
            return (
              <li key={id}>
                <button type="button" className={styles.gameCard} onClick={() => onSelectGame(id)}>
                  <span className={styles.gameTitle}>{entry?.title ?? id}</span>
                  <p className={styles.gameDescription}>{entry?.description ?? "Play now."}</p>
                  <span className={styles.gameId}>{id}</span>
                </button>
              </li>
            );
          })}
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
