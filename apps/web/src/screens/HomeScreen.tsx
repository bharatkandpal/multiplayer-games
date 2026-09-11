import { useId } from "react";
import { ENGINE_VERSION } from "@mpg/engine";
import type { GameId, RealtimeGameId } from "@mpg/engine";
import { Button } from "../components/ui";
import { loadPersonalBest } from "../game/personalBest";
import { GameThumbnail } from "./gameThumbnails";
import { buildHomeShelves, gameTags } from "./catalog";
import type { CatalogEntry, GameTag, HomeShelf } from "./catalog";
import styles from "./HomeScreen.module.css";

// The catalog itself lives in `./catalog` so the play screens can walk it for
// prev/next without importing this screen. Re-exported here because App, Invite,
// Join, Setup, and their tests all import it from this module.
export type { GameKind, GameCatalogEntry, RealtimeCatalogEntry } from "./catalog";
export { GAME_CATALOG, REALTIME_CATALOG } from "./catalog";

export interface HomeScreenProps {
  /** Registered turn-based ids (from `listGames()`) — home never hardcodes the catalog. */
  games: GameId[];
  /** Registered real-time ids (from `listRealtimeGames()`). */
  realtimeGames?: RealtimeGameId[];
  /**
   * Ids ranked by the trending read model (MPG-094), most trending first. Omit
   * until that signal is real — Home then renders no Trending shelf at all.
   */
  trending?: readonly (GameId | RealtimeGameId)[];
  /**
   * Quick-start: tapping a card starts a game immediately (vs the bot for
   * turn-based games), rather than routing to seat setup.
   */
  onSelectGame: (gameId: GameId) => void;
  onSelectRealtimeGame?: (gameId: RealtimeGameId) => void;
  /** Opens the full seat setup for a turn-based game (play a friend, online, all-bot watch). */
  onConfigureGame?: (gameId: GameId) => void;
  onShowGallery: () => void;
  /**
   * Renders the build stamp and the design-system kit link. Off by default:
   * that footer is developer chrome, and Home is the page a stranger arriving
   * from a shared link lands on (`DESIGN_LANGUAGE.md` §1). App turns it on for
   * `?dev`.
   */
  devMode?: boolean;
}

/**
 * Landing screen: pick a game to play.
 *
 * Structured as **discovery shelves** rather than one undifferentiated grid
 * (MPG-090 / PRD FR-25) — Featured carries the cold start, Trending appears
 * only once MPG-094 gives it honest signal, New surfaces recent additions, and
 * a catch-all shelf guarantees every listed game is still one tap from playable.
 *
 * One clear primary action per card (UX_PRINCIPLES §1.6): tapping a card
 * *starts the game* rather than opening seat setup. Setup is still reachable
 * per card via a secondary "Options" control for the cases that genuinely need
 * configuring (play a friend, play online, all-bot watch).
 */
export function HomeScreen({
  games,
  realtimeGames = [],
  trending,
  onSelectGame,
  onSelectRealtimeGame,
  onConfigureGame,
  onShowGallery,
  devMode = false,
}: HomeScreenProps): React.JSX.Element {
  const shelves = buildHomeShelves(games, realtimeGames, trending ? { trending } : {});

  return (
    <div className={styles.main}>
      <h1 className={styles.heading}>Multiplayer Games</h1>
      <p className={styles.tagline}>
        Tap a game to start playing straight away — you against the bot. Want a friend instead? Use
        Options on any game.
      </p>

      {shelves.length === 0 ? (
        <p className={styles.empty}>
          No games are available right now. Try reloading the page — if that doesn&apos;t help, this
          is a bug, not something you did.
        </p>
      ) : (
        shelves.map((shelf) => (
          <Shelf
            key={shelf.id}
            shelf={shelf}
            onSelectGame={onSelectGame}
            onSelectRealtimeGame={onSelectRealtimeGame}
            onConfigureGame={onConfigureGame}
          />
        ))
      )}

      {devMode ? (
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
      ) : null}
    </div>
  );
}

interface ShelfProps {
  shelf: HomeShelf;
  onSelectGame: (gameId: GameId) => void;
  // Explicitly `| undefined` rather than `?:` — these are forwarded straight
  // through from optional props under `exactOptionalPropertyTypes`.
  onSelectRealtimeGame: ((gameId: RealtimeGameId) => void) | undefined;
  onConfigureGame: ((gameId: GameId) => void) | undefined;
}

/**
 * One discovery shelf: a hairline rule, a mono micro-caps label, and its cards.
 * The rule is the quietest mark on the page by design (`DESIGN_LANGUAGE.md` §4)
 * — it states a fact about the grouping, it doesn't compete with the games.
 */
function Shelf({
  shelf,
  onSelectGame,
  onSelectRealtimeGame,
  onConfigureGame,
}: ShelfProps): React.JSX.Element {
  return (
    <section className={styles.shelf} aria-labelledby={`shelf-${shelf.id}`}>
      <div className={styles.shelfHeader}>
        <h2 className={styles.shelfTitle} id={`shelf-${shelf.id}`}>
          {shelf.title}
        </h2>
        <p className={styles.shelfBlurb}>{shelf.blurb}</p>
      </div>
      <ul className={styles.gameGrid} aria-label={`${shelf.title} games`}>
        {shelf.entries.map((entry) => (
          <li key={`${entry.kind}:${entry.id}`} className={styles.gameCell}>
            <GameCard
              entry={entry}
              onSelectGame={onSelectGame}
              onSelectRealtimeGame={onSelectRealtimeGame}
            />
            {/* Real-time games are solo — they have no seats to configure, so
                they get no Options control (ADR 0002 §2). */}
            {entry.kind === "turn-based" && onConfigureGame ? (
              <Button
                variant="ghost"
                size="sm"
                className={styles.gameOptions}
                onClick={() => onConfigureGame(entry.id)}
                aria-label={`Options for ${entry.title} — play a friend, online, or watch bots`}
              >
                Options
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface GameCardProps {
  entry: CatalogEntry;
  onSelectGame: (gameId: GameId) => void;
  onSelectRealtimeGame: ((gameId: RealtimeGameId) => void) | undefined;
}

/**
 * A single game card, in its family's temperature: turn-based cards are matte
 * table stock, real-time cards are lit cabinet panels (`DESIGN_LANGUAGE.md` §2).
 * Because the shelves group by discovery rather than by family, the card itself
 * is what tells a player which of the two they're looking at.
 *
 * The description and tags live inside the button but are wired through
 * `aria-describedby`, not the accessible name — so the card is still announced
 * and still addressable as just its title (MPG-052) while the prose that was
 * previously written and never rendered finally reaches the player.
 */
function GameCard({ entry, onSelectGame, onSelectRealtimeGame }: GameCardProps): React.JSX.Element {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-desc`;
  const tagsId = `${baseId}-tags`;
  const bestId = `${baseId}-best`;

  // Real-time games are the only ones that carry a score, so they're the only
  // ones with a personal best. Read straight from local storage — see
  // `game/personalBest` for why this deliberately isn't the leaderboard.
  const personalBest = entry.kind === "realtime" ? loadPersonalBest(entry.id) : undefined;

  return (
    <button
      type="button"
      className={entry.kind === "realtime" ? styles.cabinetCard : styles.tableCard}
      onClick={() =>
        entry.kind === "realtime" ? onSelectRealtimeGame?.(entry.id) : onSelectGame(entry.id)
      }
      aria-labelledby={titleId}
      aria-describedby={
        personalBest === undefined
          ? `${descriptionId} ${tagsId}`
          : `${descriptionId} ${tagsId} ${bestId}`
      }
    >
      <span className={styles.gameThumbnail}>
        <GameThumbnail gameId={entry.id} />
      </span>
      <span className={styles.gameTitle} id={titleId}>
        {entry.title}
      </span>
      <span className={styles.gameDescription} id={descriptionId}>
        {entry.description}
      </span>
      <span className={styles.tagRow} id={tagsId}>
        {/* The family marker. The cabinet treatment says "arcade" visually, but
            a visual-only signal isn't a signal for everyone — this keeps it in
            the text, where it was before the shelves split by discovery. */}
        {entry.kind === "realtime" ? <span className={styles.kindChip}>Solo arcade</span> : null}
        {gameTags(entry).map((tag, index) => (
          <span
            key={tag}
            // The seat tag comes first out of `gameTags()` and is the only
            // filled chip — it answers "can I play this with someone?" at a
            // glance, and keeps the rest of the row from turning into confetti.
            className={index === 0 ? styles.seatChip : styles.tagChip}
          >
            {TAG_LABEL[tag]}
          </span>
        ))}
      </span>
      {personalBest === undefined ? null : (
        <span className={styles.personalBest} id={bestId}>
          Your best <span className={styles.personalBestValue}>{personalBest}</span>
        </span>
      )}
    </button>
  );
}

/** Player-facing wording for each tag — the union's ids are not copy. */
const TAG_LABEL: Record<GameTag, string> = {
  solo: "Solo",
  "2-player": "2 players",
  multiplayer: "Multiplayer",
  "vs-bot": "vs bot",
  online: "Online",
  watch: "Watch",
  quick: "Quick",
  endless: "Endless",
};
