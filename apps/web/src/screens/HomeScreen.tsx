import { ENGINE_VERSION } from "@mpg/engine";
import type { GameId, RealtimeGameId } from "@mpg/engine";
import { Button } from "../components/ui";
import { GameThumbnail } from "./gameThumbnails";
import { buildGameItems, GAME_CATALOG, REALTIME_CATALOG } from "./catalog";
import type { GameItem } from "./catalog";
import { pickGameOfTheDay } from "./gameOfTheDay";
import styles from "./HomeScreen.module.css";

// The catalog itself lives in `./catalog` so the play screens can walk it for
// prev/next without importing this screen. Re-exported here because App, Invite,
// Join, Setup, and their tests all import it from this module.
export type { GameKind, GameCatalogEntry, RealtimeCatalogEntry } from "./catalog";
export { GAME_CATALOG, REALTIME_CATALOG } from "./catalog";

/** The catalog blurb for a listed game, used by the Game-of-the-day spotlight. */
function itemDescription(item: GameItem): string {
  const entry = item.kind === "realtime" ? REALTIME_CATALOG[item.id] : GAME_CATALOG[item.id];
  return entry?.description ?? "";
}

export interface HomeScreenProps {
  /** Registered turn-based ids (from `listGames()`) — home never hardcodes the catalog. */
  games: GameId[];
  /** Registered real-time ids (from `listRealtimeGames()`). */
  realtimeGames?: RealtimeGameId[];
  /**
   * Quick-start: tapping a card starts a game immediately (vs the bot for
   * turn-based games), rather than routing to seat setup.
   */
  onSelectGame: (gameId: GameId) => void;
  onSelectRealtimeGame?: (gameId: RealtimeGameId) => void;
  /** Opens the full seat setup for a turn-based game (play a friend, online, all-bot watch). */
  onConfigureGame?: (gameId: GameId) => void;
  onShowGallery: () => void;
}

/**
 * Landing screen: pick a game to play. One clear primary action per card
 * (UX_PRINCIPLES §1.6) — tapping a card now *starts the game* rather than
 * opening seat setup, so every game is one tap from playable. Setup is still
 * reachable per card via a secondary "Options" control for the cases that
 * genuinely need configuring (play a friend, play online, all-bot watch).
 */
export function HomeScreen({
  games,
  realtimeGames = [],
  onSelectGame,
  onSelectRealtimeGame,
  onConfigureGame,
  onShowGallery,
}: HomeScreenProps): React.JSX.Element {
  const items = buildGameItems(games, realtimeGames);
  const featured = pickGameOfTheDay(items);

  const playItem = (item: GameItem): void => {
    if (item.kind === "realtime") onSelectRealtimeGame?.(item.id);
    else onSelectGame(item.id);
  };

  return (
    <div className={styles.main}>
      <h1 className={styles.heading}>Multiplayer Games</h1>
      <p className={styles.tagline}>
        Tap a game to start playing straight away — you against the bot. Want a friend instead? Use
        Options on any game.
      </p>

      {featured ? (
        <section className={styles.featured} aria-labelledby="game-of-the-day">
          <h2 id="game-of-the-day" className={styles.featuredLabel}>
            Game of the day
          </h2>
          <button type="button" className={styles.featuredCard} onClick={() => playItem(featured)}>
            <span className={styles.featuredThumbnail}>
              <GameThumbnail gameId={featured.id} />
            </span>
            <span className={styles.featuredBody}>
              <span className={styles.featuredTitle}>{featured.title}</span>
              <span className={styles.featuredDescription}>{itemDescription(featured)}</span>
              <span className={styles.featuredCta}>Play now →</span>
            </span>
          </button>
        </section>
      ) : null}

      <h2 className={styles.sectionHeading}>Choose a game</h2>
      {items.length === 0 ? (
        <p className={styles.empty}>
          No games are available right now. Try reloading the page — if that doesn&apos;t help, this
          is a bug, not something you did.
        </p>
      ) : (
        <ul className={styles.gameGrid} aria-label="Available games">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className={styles.gameCell}>
              <button type="button" className={styles.gameCard} onClick={() => playItem(item)}>
                <span className={styles.gameThumbnail}>
                  <GameThumbnail gameId={item.id} />
                </span>
                <span className={styles.gameTitle}>{item.title}</span>
                {item.kind === "realtime" ? (
                  <span className={styles.gameKindTag}>Solo arcade</span>
                ) : null}
              </button>
              {/* Real-time games are solo — they have no seats to configure, so
                  they get no Options control (ADR 0002 §2). */}
              {item.kind === "turn-based" && onConfigureGame ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.gameOptions}
                  onClick={() => onConfigureGame(item.id)}
                  aria-label={`Options for ${item.title} — play a friend, online, or watch bots`}
                >
                  Options
                </Button>
              ) : null}
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
