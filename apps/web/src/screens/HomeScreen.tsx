import { useId, useState } from "react";
import { ENGINE_VERSION } from "@mpg/engine";
import type { GameId, RealtimeGameId } from "@mpg/engine";
import { Button, UsernameBadge } from "../components/ui";
import { loadPersonalBest } from "../game/personalBest";
import { GameThumbnail } from "./gameThumbnails";
import {
  TAG_LABEL,
  buildHomeShelves,
  filterByTag,
  filterableTags,
  gameTags,
  listCatalogEntries,
  tagFilterNarrows,
} from "./catalog";
import type { CatalogEntry, GameTag, HomeShelf, ShelfDensity } from "./catalog";
import { SurpriseMe } from "./SurpriseMe";
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
   * The id to spotlight as "Game of the day" (see `gameOfTheDay.ts`). Omit for
   * no spotlight shelf — a placeholder recommender App opts into, kept off the
   * default render the way `trending` is.
   */
  gameOfTheDay?: GameId | RealtimeGameId;
  /**
   * Quick-start: tapping a card starts a game immediately (vs the bot for
   * turn-based games), rather than routing to seat setup.
   */
  onSelectGame: (gameId: GameId) => void;
  onSelectRealtimeGame?: (gameId: RealtimeGameId) => void;
  /** Opens the full seat setup for a turn-based game (play a friend, online, all-bot watch). */
  onConfigureGame?: (gameId: GameId) => void;
  /** CHAT-004: opens the standalone chat lobby. Omit to hide the entry point entirely. */
  onOpenChat?: () => void;
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
 * the tail shelves guarantee every listed game is still one tap from playable.
 *
 * Since UI-17 the shelves also differ in **size**: one marquee, tiles for the
 * shelves that recommend, compact rows for the long tail. A grid of identical
 * cards is a list; three sizes is a room. Each shelf carries its own density
 * (`HomeShelf.density`), so the hierarchy is decided with the grouping rather
 * than in a lookup table here.
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
  gameOfTheDay,
  onSelectGame,
  onSelectRealtimeGame,
  onConfigureGame,
  onOpenChat,
  onShowGallery,
  devMode = false,
}: HomeScreenProps): React.JSX.Element {
  const [activeTag, setActiveTag] = useState<GameTag | null>(null);

  const shelves = buildHomeShelves(games, realtimeGames, {
    ...(trending ? { trending } : {}),
    ...(gameOfTheDay ? { gameOfTheDay } : {}),
  });

  const entries = listCatalogEntries(games, realtimeGames);
  const tags = filterableTags(entries);
  // Offered only when some chip would actually narrow the page — see
  // `tagFilterNarrows`. A filter that cannot change what you see is clutter.
  const showFilter = shelves.length > 0 && tagFilterNarrows(entries);

  // What the dice may land on: the games currently VISIBLE, so an active tag
  // filter narrows the draw. A player who filtered to "Quick" has told us what
  // they want, and a random pick that ignored it would be the one control on the
  // page that doesn't listen.
  // ...and only games this Home can actually launch: without an
  // `onSelectRealtimeGame` handler an arcade pick would do nothing at all, and a
  // dice that sometimes does nothing is worse than no dice.
  const visible = activeTag === null ? entries : filterByTag(entries, activeTag);
  const surpriseFrom = visible.filter(
    (entry) => entry.kind === "turn-based" || onSelectRealtimeGame !== undefined,
  );

  // Playing a random pick goes straight into the game, never to seat setup —
  // "surprise me" promises a game, not a configuration screen. A turn-based pick
  // starts against the bot, exactly like tapping its card does.
  const playEntry = (entry: CatalogEntry): void => {
    if (entry.kind === "realtime") onSelectRealtimeGame?.(entry.id);
    else onSelectGame(entry.id);
  };

  return (
    <div className={styles.main}>
      <h1 className={styles.heading}>Multiplayer Games</h1>
      <p className={styles.tagline}>
        Tap a game to start playing straight away — you against the bot. Want a friend instead? Use
        Options on any game.
      </p>

      <div className={styles.identityRow}>
        <UsernameBadge compact className={styles.identityBadge} />
        {/* CHAT-004: the one entry point into chat — a labelled button, not a
            glyph a first-timer has to guess at (UX_PRINCIPLES §9). Pinned beside
            the badge on one row; the badge truncates before this ever wraps, so
            the header stays inside the frame at 320px (MPG-137). */}
        {onOpenChat ? (
          <Button variant="secondary" size="sm" className={styles.chatButton} onClick={onOpenChat}>
            Chat
          </Button>
        ) : null}
      </div>

      {/* The browse controls: narrow the shelf, or skip choosing entirely. Kept
          on one row because they answer the same question ("what do I play?")
          from opposite ends. Either half can be absent without the other moving.

          UI-17: the row is a **sticky rail**. A catalogue this size is a long
          scroll, and the controls that navigate it were only reachable by
          scrolling back to the top. It sticks inside App's single scrolling
          region (`App.module.css` `.screen`) rather than becoming new fixed
          chrome — the page still scrolls in exactly one place (MPG-137). */}
      {showFilter || surpriseFrom.length > 0 ? (
        <div className={styles.browseRail}>
          <div className={styles.controlRow}>
            {showFilter ? (
              <TagFilter tags={tags} activeTag={activeTag} onChange={setActiveTag} />
            ) : null}
            {/* Pinned outside the chip scroller: a growing tag list scrolls,
                it never pushes the dice off the edge of the rail. */}
            <span className={styles.railAction}>
              <SurpriseMe entries={surpriseFrom} onPick={playEntry} />
            </span>
          </div>
        </div>
      ) : null}

      {shelves.length === 0 ? (
        <p className={styles.empty}>
          No games are available right now. Try reloading the page — if that doesn&apos;t help, this
          is a bug, not something you did.
        </p>
      ) : activeTag === null ? (
        shelves.map((shelf) => (
          <Shelf
            key={shelf.id}
            shelf={shelf}
            onSelectGame={onSelectGame}
            onSelectRealtimeGame={onSelectRealtimeGame}
            onConfigureGame={onConfigureGame}
          />
        ))
      ) : (
        <FilteredResults
          tag={activeTag}
          matches={filterByTag(entries, activeTag)}
          onSelectGame={onSelectGame}
          onSelectRealtimeGame={onSelectRealtimeGame}
          onConfigureGame={onConfigureGame}
        />
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

interface TagFilterProps {
  tags: readonly GameTag[];
  activeTag: GameTag | null;
  onChange: (tag: GameTag | null) => void;
}

/**
 * The tag filter row (MPG-112 / UI-5): the first thing that makes a ten-game
 * catalogue browsable rather than just scrollable.
 *
 * Toggle buttons, not a listbox or a set of links — a filter is a thing you
 * switch on and off, and `aria-pressed` says exactly that without inventing a
 * widget a screen-reader user has to learn. "All" is the off position rather
 * than a ninth tag, so clearing is always one tap and never a hunt for which
 * chip is currently lit.
 *
 * Only tags some listed game actually carries are offered (`filterableTags`),
 * so no chip here can lead to an empty page.
 */
function TagFilter({ tags, activeTag, onChange }: TagFilterProps): React.JSX.Element {
  return (
    <div className={styles.filterRow} role="group" aria-label="Filter games by tag">
      <button
        type="button"
        className={styles.filterChip}
        aria-pressed={activeTag === null}
        onClick={() => onChange(null)}
      >
        All
      </button>
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          className={styles.filterChip}
          aria-pressed={activeTag === tag}
          // Tapping the active chip clears it — the chip a player just pressed
          // is the most obvious place to reach for to undo it.
          onClick={() => onChange(activeTag === tag ? null : tag)}
        >
          {TAG_LABEL[tag]}
        </button>
      ))}
    </div>
  );
}

interface FilteredResultsProps {
  tag: GameTag;
  matches: readonly CatalogEntry[];
  onSelectGame: (gameId: GameId) => void;
  onSelectRealtimeGame: ((gameId: RealtimeGameId) => void) | undefined;
  onConfigureGame: ((gameId: GameId) => void) | undefined;
}

/**
 * What Home shows while a filter is on: one flat grid, replacing the shelves.
 *
 * The shelves answer "what should I play?" — once a player has told us what
 * they want, that framing is noise, and at this catalogue size keeping it would
 * leave a column of one- and two-card shelves. The shelves come straight back
 * the moment the filter clears, so nothing is lost, only set aside.
 *
 * The count is a heading rather than a bare line so it lands in the document
 * outline where the shelf headings were, and reuses the shelf's own type so the
 * page doesn't change voice mid-session. `filterableTags` guarantees `matches`
 * is never empty, which is why there is no empty state here.
 */
function FilteredResults({
  tag,
  matches,
  onSelectGame,
  onSelectRealtimeGame,
  onConfigureGame,
}: FilteredResultsProps): React.JSX.Element {
  return (
    <section className={styles.results} aria-labelledby="filter-results">
      <div className={styles.shelfHeader}>
        <h2 className={styles.shelfTitle} id="filter-results">
          {matches.length} {matches.length === 1 ? "game" : "games"}
        </h2>
        <p className={styles.shelfBlurb}>Tagged {TAG_LABEL[tag].toLowerCase()}.</p>
      </div>
      <GameList
        entries={matches}
        density="tile"
        label={`Games tagged ${TAG_LABEL[tag]}`}
        onSelectGame={onSelectGame}
        onSelectRealtimeGame={onSelectRealtimeGame}
        onConfigureGame={onConfigureGame}
      />
    </section>
  );
}

interface GameListProps {
  entries: readonly CatalogEntry[];
  /** How big these games draw — see `ShelfDensity`. */
  density: ShelfDensity;
  label: string;
  onSelectGame: (gameId: GameId) => void;
  onSelectRealtimeGame: ((gameId: RealtimeGameId) => void) | undefined;
  onConfigureGame: ((gameId: GameId) => void) | undefined;
}

/** The container class for each density — the list is the same list either way. */
const LIST_CLASS: Record<ShelfDensity, string | undefined> = {
  marquee: styles.marqueeList,
  tile: styles.gameGrid,
  row: styles.rowList,
};

const CELL_CLASS: Record<ShelfDensity, string | undefined> = {
  marquee: styles.gameCell,
  tile: styles.gameCell,
  row: styles.rowCell,
};

/**
 * The list of cards, shared by every shelf and by the filtered result list, so
 * they can never drift on card wiring or on the Options control.
 *
 * **One list, three sizes** (UI-17). The structure — a `ul` of cells, each a
 * card plus an optional Options control — is identical at every density; only
 * the geometry changes. That is what keeps a compact row as reachable, as
 * routable and as announced as a marquee, rather than the long tail quietly
 * becoming a second-class surface.
 */
function GameList({
  entries,
  density,
  label,
  onSelectGame,
  onSelectRealtimeGame,
  onConfigureGame,
}: GameListProps): React.JSX.Element {
  return (
    <ul className={LIST_CLASS[density]} aria-label={label}>
      {entries.map((entry) => (
        <li key={`${entry.kind}:${entry.id}`} className={CELL_CLASS[density]}>
          <GameCard
            entry={entry}
            density={density}
            onSelectGame={onSelectGame}
            onSelectRealtimeGame={onSelectRealtimeGame}
          />
          {/* Real-time games are solo — they have no seats to configure, so
              they get no Options control (ADR 0002 §2). */}
          {entry.kind === "turn-based" && onConfigureGame ? (
            <Button
              variant="ghost"
              size="sm"
              // In a row Options is a sibling in the strip, not a corner
              // overlay: a 48px row has no corner to hide it in, and the meta
              // it would sit on top of is the row's only other content.
              className={density === "row" ? styles.rowOptions : styles.gameOptions}
              onClick={() => onConfigureGame(entry.id)}
              aria-label={`Options for ${entry.title} — play a friend, online, or watch bots`}
            >
              Options
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
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
 * The `aria-label` for a shelf's list.
 *
 * The tail shelves are already noun phrases naming a set of games, so "The
 * cabinet games" would only be clumsier than "The cabinet". Everything else
 * reads as an adjective and takes the noun.
 */
function listLabel(shelf: HomeShelf): string {
  return shelf.id === "cabinet" || shelf.id === "table" ? shelf.title : `${shelf.title} games`;
}

/**
 * One discovery shelf: a hairline rule, a mono micro-caps label, a count, and
 * its games at the shelf's own density. The rule is the quietest mark on the
 * page by design (`DESIGN_LANGUAGE.md` §4) — it states a fact about the
 * grouping, it doesn't compete with the games.
 */
function Shelf({
  shelf,
  onSelectGame,
  onSelectRealtimeGame,
  onConfigureGame,
}: ShelfProps): React.JSX.Element {
  // The Game-of-the-day shelf carries the same markup and card wiring as any
  // other shelf — it's just the one drawn at marquee size, with an accent label.
  const isSpotlight = shelf.density === "marquee";
  return (
    <section className={styles.shelf} aria-labelledby={`shelf-${shelf.id}`}>
      <div className={styles.shelfHeader}>
        <h2
          className={
            isSpotlight ? `${styles.shelfTitle} ${styles.spotlightTitle}` : styles.shelfTitle
          }
          id={`shelf-${shelf.id}`}
        >
          {shelf.title}
        </h2>
        {/* The count answers what the blurbs mostly no longer do: how much is
            under this heading. Hidden from AT — the list below announces its
            own length, and "4" on its own is not a sentence. A marquee holds
            exactly one game, so counting it would be noise. */}
        {isSpotlight ? null : (
          <span className={styles.shelfCount} aria-hidden="true">
            {shelf.entries.length}
          </span>
        )}
      </div>
      {shelf.blurb ? <p className={styles.shelfBlurb}>{shelf.blurb}</p> : null}
      <GameList
        entries={shelf.entries}
        density={shelf.density}
        label={listLabel(shelf)}
        onSelectGame={onSelectGame}
        onSelectRealtimeGame={onSelectRealtimeGame}
        onConfigureGame={onConfigureGame}
      />
    </section>
  );
}

interface GameCardProps {
  entry: CatalogEntry;
  density: ShelfDensity;
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
/**
 * A card description with its hook phrase bolded. Splits on the first occurrence
 * of `emphasis` so the phrase reads as emphasised text inside the sentence; when
 * `emphasis` is absent or isn't found, the description renders unchanged — no
 * card is ever broken by a mismatched phrase.
 */
function renderDescription(description: string, emphasis?: string): React.ReactNode {
  if (!emphasis) return description;
  const at = description.indexOf(emphasis);
  if (at === -1) return description;
  return (
    <>
      {description.slice(0, at)}
      <strong className={styles.descriptionEmphasis}>{emphasis}</strong>
      {description.slice(at + emphasis.length)}
    </>
  );
}

/**
 * The one tag a compact row shows, out of the four or five a game carries.
 *
 * A row is a scanning surface, so it gets the tag that actually *distinguishes*
 * this game from its neighbours on the same shelf. For a table game that's the
 * seat count ("2 players"). For an arcade game it isn't "Solo" — the whole
 * cabinet is solo, so a Solo chip on every row is a column of noise — it's the
 * shape of the session: quick, or endless.
 *
 * The tags this drops are not lost: the row keeps the full list for assistive
 * tech (see `GameCard`), so nobody is shown less than a tile shows.
 */
function rowTag(entry: CatalogEntry): GameTag {
  const [seat, ...rest] = gameTags(entry);
  if (entry.kind === "realtime") {
    const shape = rest.find((tag) => tag === "quick" || tag === "endless");
    if (shape !== undefined) return shape;
  }
  // `gameTags()` always yields the derived seat tag first, so this is never
  // undefined — the assertion is for `noUncheckedIndexedAccess`, not a guess.
  return seat as GameTag;
}

function GameCard({
  entry,
  density,
  onSelectGame,
  onSelectRealtimeGame,
}: GameCardProps): React.JSX.Element {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-desc`;
  const tagsId = `${baseId}-tags`;
  const bestId = `${baseId}-best`;

  // Real-time games are the only ones that carry a score, so they're the only
  // ones with a personal best. Read straight from local storage — see
  // `game/personalBest` for why this deliberately isn't the leaderboard.
  const personalBest = entry.kind === "realtime" ? loadPersonalBest(entry.id) : undefined;

  const ground = entry.kind === "realtime" ? styles.cabinetCard : styles.tableCard;
  const size =
    density === "marquee"
      ? styles.marqueeCard
      : density === "row"
        ? styles.rowCard
        : styles.tileCard;

  const thumbnail = (
    <span className={styles.gameThumbnail}>
      <GameThumbnail gameId={entry.id} />
    </span>
  );
  const title = (
    <span className={styles.gameTitle} id={titleId}>
      {entry.title}
    </span>
  );
  const best =
    personalBest === undefined ? null : (
      <span className={styles.personalBest} id={bestId}>
        Your best <span className={styles.personalBestValue}>{personalBest}</span>
      </span>
    );

  // The chips, in full. `hidden` drops a chip from the page while leaving it in
  // the accessible description — which is how a row shows one tag and still
  // announces all of them.
  const chips = (
    <span className={styles.tagRow} id={tagsId}>
      {/* The family marker. The cabinet treatment says "arcade" visually, but
          a visual-only signal isn't a signal for everyone — this keeps it in
          the text, where it was before the shelves split by discovery. */}
      {entry.kind === "realtime" ? (
        <span className={density === "row" ? styles.srOnly : styles.kindChip}>Solo arcade</span>
      ) : null}
      {gameTags(entry).map((tag, index) => (
        <span
          key={tag}
          // The seat tag comes first out of `gameTags()` and is the only
          // filled chip — it answers "can I play this with someone?" at a
          // glance, and keeps the rest of the row from turning into confetti.
          className={
            density === "row" && tag !== rowTag(entry)
              ? styles.srOnly
              : index === 0
                ? styles.seatChip
                : styles.tagChip
          }
        >
          {TAG_LABEL[tag]}
        </span>
      ))}
    </span>
  );

  const body =
    density === "row" ? (
      // A dense strip: thumbnail, title, and the one distinguishing fact.
      // The description is carried but not drawn — see `.srOnly`.
      <>
        {thumbnail}
        {title}
        <span className={styles.rowMeta}>
          {chips}
          {best}
        </span>
        <span className={styles.srOnly} id={descriptionId}>
          {entry.description}
        </span>
      </>
    ) : density === "marquee" ? (
      <>
        <span className={styles.marqueeTop}>
          {thumbnail}
          {title}
        </span>
        {/* The one place a description is shown in full rather than clamped:
            the marquee is the page's single recommendation, so it gets to make
            the case for itself (see the clamp note in the stylesheet). */}
        <span className={styles.gameDescription} id={descriptionId}>
          {renderDescription(entry.description, entry.emphasis)}
        </span>
        <span className={styles.marqueeFoot}>
          {chips}
          {best}
          {/* A styled span, not a nested button — a button inside a button is
              invalid, and the whole marquee is already the target. It names the
              action the way the mock's Play control does without shrinking the
              tap area to the size of the pill. */}
          <span className={styles.playPill} aria-hidden="true">
            Play
          </span>
        </span>
      </>
    ) : (
      <>
        {thumbnail}
        {title}
        <span className={styles.gameDescription} id={descriptionId}>
          {renderDescription(entry.description, entry.emphasis)}
        </span>
        {chips}
        {best}
      </>
    );

  return (
    <button
      type="button"
      className={`${styles.card} ${ground} ${size}`}
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
      {body}
    </button>
  );
}
