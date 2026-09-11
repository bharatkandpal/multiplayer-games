import { useCallback, useEffect, useMemo, useState } from "react";
import {
  hasGame,
  hasRealtimeGame,
  listGames,
  listRealtimeGames,
  registerBuiltInGames,
  registerBuiltInRealtimeGames,
} from "@mpg/engine";
import type { GameId, RealtimeGameId } from "@mpg/engine";
import { useTheme } from "./lib/useTheme";
import { UiGallery } from "./components/UiGallery";
import { Button, UsernamePrompt } from "./components/ui";
import {
  ConnectFourOnlineRoute,
  ConnectFourRoute,
  ConnectFourWatchRoute,
  HomeScreen,
  InviteScreen,
  JoinScreen,
  LeaderboardScreen,
  NimRoute,
  GomokuRoute,
  RealtimeGameRoute,
  SetupScreen,
  TicTacToeMoveOnlineRoute,
  TicTacToeMoveRoute,
  TicTacToeMoveWatchRoute,
  TicTacToeOnlineRoute,
  TicTacToeRoute,
  TicTacToeWatchRoute,
  type GameRouteProps,
  type OnlineGameRouteProps,
  type WatchGameRouteProps,
} from "./screens";
import { GAME_CATALOG, REALTIME_CATALOG } from "./screens/HomeScreen";
import { SharedResultScreen } from "./screens/SharedResultScreen";
import { buildGameItems, nextGame, type GameItem } from "./screens/catalog";
import { pickGameOfTheDay } from "./screens/gameOfTheDay";
import { GameSwitcher } from "./screens/GameSwitcher";
import { isAllBotRoom, publicRoomToSeats, toSeatConfigInput } from "./api/roomSeats";
import { getStoredUsername } from "./api/username";
import { initSession } from "./api/session";
import { getStoredCreatorToken } from "./api/watchSession";
import { useRoom } from "./hooks/useRoom";
import { useUsernameGate } from "./hooks/useUsernameGate";
import { presetSeats, type SeatsConfig } from "./game";
import { hasCosmetics } from "./cosmetics";
import { registerDrunkWalkCosmetics } from "./components/realtime/drunkWalkCharacter";
import styles from "./App.module.css";

// Registering is idempotent-safe to call once at module scope: React's dev-mode
// double-invocation of components must not throw on a second registration.
if (!hasGame("tictactoe") && !hasGame("connect4")) {
  registerBuiltInGames();
}
if (!hasRealtimeGame("floppy-birds")) {
  registerBuiltInRealtimeGames();
}
// Cosmetics register separately from the engine modules, and deliberately so:
// the engine must never learn what a hat is (MPG-088-a).
if (!hasCosmetics("drunk-walk")) {
  registerDrunkWalkCosmetics();
}

type Route =
  | { screen: "home" }
  | { screen: "setup"; gameId: GameId }
  | { screen: "play"; gameId: GameId; seats: SeatsConfig }
  // Real-time (solo arcade) games skip Setup entirely — nothing to configure
  // for a solo run — and go straight to the realtime play surface (ADR 0002 §2).
  | { screen: "realtime"; gameId: RealtimeGameId }
  | { screen: "gallery" }
  // MPG-012: the room creator waits here for the invite link to be opened.
  | { screen: "invite"; gameId: GameId; roomId: string; inviteUrl: string }
  // MPG-012: an invite link (`/:gameId/room/:roomId`) was opened directly.
  | { screen: "join"; gameId: GameId; roomId: string }
  // MPG-068: a room reached `active` — play over the socket instead of the
  // local engine. `seats` is a snapshot (for the seat row / rematch presets),
  // not authoritative — `OnlineGameRoute` gets live state via the socket.
  | { screen: "online-play"; gameId: GameId; roomId: string; seats: SeatsConfig }
  // MPG-025: an all-bot room the creator is watching, server-driven — reached
  // either straight from Setup (see `handlePlayOnline`) or by reopening this
  // tab's own watch link after a reload (`getStoredCreatorToken`, below).
  | { screen: "watch"; gameId: GameId; roomId: string }
  // MPG-055: the full leaderboard for a game, reached from the post-game rank
  // preview ("View full leaderboard"). "Home" always exits back to the home
  // screen, not back to the (now-finished) game.
  // `gameId` spans both families: real-time games rank on `score`, turn-based
  // on win/loss/draw, and the same screen renders either.
  | { screen: "leaderboard"; gameId: GameId | RealtimeGameId }
  // MPG-056: a durable share link (`/s/:token`) was opened. Unlike the room
  // invite above, this outlives every room — the token resolves to a finished
  // result, a replay, or a leaderboard view, and needs no session to read.
  | { screen: "shared"; token: string };

const ROOM_PATH_RE = /^\/([^/]+)\/room\/([^/]+)\/?$/;
const SHARE_PATH_RE = /^\/s\/([^/]+)\/?$/;

/** Parses `/s/:token` out of a pathname (MPG-056). */
function parseSharePath(pathname: string): string | undefined {
  const match = SHARE_PATH_RE.exec(pathname);
  const token = match?.[1];
  return token ? decodeURIComponent(token) : undefined;
}

/** Parses `/:gameId/room/:roomId` out of a pathname, if it matches a known game. */
function parseRoomPath(pathname: string): { gameId: GameId; roomId: string } | undefined {
  const match = ROOM_PATH_RE.exec(pathname);
  if (!match) return undefined;
  const [, gameId, roomId] = match;
  if (!gameId || !roomId || !hasGame(gameId as GameId)) return undefined;
  return { gameId: gameId as GameId, roomId: decodeURIComponent(roomId) };
}

function initialRoute(): Route {
  if (typeof window === "undefined") return { screen: "home" };
  // A share link is checked FIRST: it is the one entry point reached by people
  // who have never used the app, so it must not fall through to Home.
  const shareToken = parseSharePath(window.location.pathname);
  if (shareToken) return { screen: "shared", token: shareToken };
  const parsed = parseRoomPath(window.location.pathname);
  if (!parsed) return { screen: "home" };
  // MPG-025: a reload of this tab's own all-bot watch room — its creator
  // credential (persisted the moment the room was created, see `useRoom`'s
  // `createRoom`) is how we tell "this is the room I'm watching" apart from
  // "this is an invite link someone opened" (the ordinary `join` case below),
  // since a watch room has no seat/sessionToken to recognize it by otherwise.
  if (getStoredCreatorToken(parsed.roomId)) {
    return { screen: "watch", gameId: parsed.gameId, roomId: parsed.roomId };
  }
  return { screen: "join", gameId: parsed.gameId, roomId: parsed.roomId };
}

/**
 * True when the URL carries `?dev`, which is the only thing that puts developer
 * chrome (the engine build stamp, the design-system kit) on Home. Default-off
 * because Home is where a stranger following a shared link lands, and a build
 * stamp is not what should greet them (`DESIGN_LANGUAGE.md` §1).
 */
function isDevMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("dev");
}

function buildInviteUrl(gameId: GameId, roomId: string): string {
  const path = `/${gameId}/room/${roomId}`;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

const THEME_LABEL: Record<ReturnType<typeof useTheme>["theme"], string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const GAME_ROUTES: Partial<Record<GameId, (props: GameRouteProps) => React.JSX.Element>> = {
  tictactoe: TicTacToeRoute,
  "tictactoe-move": TicTacToeMoveRoute,
  connect4: ConnectFourRoute,
  nim: NimRoute,
  gomoku: GomokuRoute,
};

function GameRoute({
  gameId,
  seats,
  onExit,
  onPlayAgain,
  onNextGame,
  onViewLeaderboard,
}: { gameId: GameId } & GameRouteProps): React.JSX.Element {
  const Route = GAME_ROUTES[gameId] ?? ConnectFourRoute;
  return (
    <Route
      seats={seats}
      onExit={onExit}
      {...(onPlayAgain ? { onPlayAgain } : {})}
      {...(onNextGame ? { onNextGame } : {})}
      {...(onViewLeaderboard ? { onViewLeaderboard } : {})}
    />
  );
}

// MPG-068: the online (room-backed) counterpart to `GAME_ROUTES`/`GameRoute` —
// drives gameplay over the socket instead of a local engine once a room
// reaches `active`.
const ONLINE_GAME_ROUTES: Partial<
  Record<GameId, (props: OnlineGameRouteProps) => React.JSX.Element>
> = {
  tictactoe: TicTacToeOnlineRoute,
  "tictactoe-move": TicTacToeMoveOnlineRoute,
  connect4: ConnectFourOnlineRoute,
};

function OnlineGameRoute({
  gameId,
  ...rest
}: { gameId: GameId } & OnlineGameRouteProps): React.JSX.Element {
  const Route = ONLINE_GAME_ROUTES[gameId] ?? ConnectFourOnlineRoute;
  return <Route {...rest} />;
}

// MPG-025: the read-only, all-bot counterpart to `ONLINE_GAME_ROUTES` — drives
// a "watch" room over the socket via `WatchGamePlayScreen` instead.
const WATCH_GAME_ROUTES: Partial<
  Record<GameId, (props: WatchGameRouteProps) => React.JSX.Element>
> = {
  tictactoe: TicTacToeWatchRoute,
  "tictactoe-move": TicTacToeMoveWatchRoute,
  connect4: ConnectFourWatchRoute,
};

function WatchGameRoute({
  gameId,
  ...rest
}: { gameId: GameId } & WatchGameRouteProps): React.JSX.Element {
  const Route = WATCH_GAME_ROUTES[gameId] ?? ConnectFourWatchRoute;
  return <Route {...rest} />;
}

const LEADERBOARD_METRIC: Partial<Record<GameId, "wld" | "score">> = {
  tictactoe: "wld",
  "tictactoe-move": "wld",
  connect4: "wld",
};

/**
 * App shell: a lightweight, state-driven router (Home → Setup → Play) plus the
 * persistent theme toggle. Home is the default view — the design-system kit
 * (MPG-029-c) is still reachable via a secondary link, not the default screen.
 */
export default function App(): React.JSX.Element {
  const games = useMemo(() => listGames(), []);
  const realtimeGames = useMemo(() => listRealtimeGames(), []);
  const { theme, resolvedTheme, cycleTheme } = useTheme();
  const [route, setRoute] = useState<Route>(initialRoute);
  // MPG-050: `useLocalPlayController` only (re-)initializes its session on
  // mount, so starting a genuinely fresh game (different opponents, not a
  // same-seats Rematch) needs the whole play screen to remount rather than
  // just receiving new `seats` props. Bumped every time a fresh game starts
  // and folded into the route's React `key` below.
  const [playNonce, setPlayNonce] = useState(0);

  // MPG-012: room lifecycle (create/join/leave, live seat state) for the
  // invite/join flow below. A single shared instance — only one online room
  // is ever "current" for this tab at a time.
  const {
    room,
    yourSlot,
    sessionToken,
    creatorToken,
    error: roomError,
    clearError: clearRoomError,
    createRoom,
    joinRoom,
    leaveRoom,
  } = useRoom();

  const goHome = useCallback((): void => {
    setRoute({ screen: "home" });
    if (typeof window !== "undefined") window.history.pushState({}, "", "/");
  }, []);

  // The one ordered catalog behind both the Home grid and the prev/next game
  // switcher on the play screens.
  const gameItems = useMemo(() => buildGameItems(games, realtimeGames), [games, realtimeGames]);

  // The game spotlighted on Home as "Game of the day" — a simple daily rotation
  // (see `gameOfTheDay.ts`) standing in until the real recommendation engine
  // lands. Memoized so it's stable for the session; it only turns over across a
  // local-midnight boundary, which a session doesn't outlive in practice.
  const gameOfTheDayId = useMemo(() => pickGameOfTheDay(gameItems)?.id, [gameItems]);

  /**
   * Quick-start: go straight into a playable game, skipping seat setup. A
   * turn-based game starts you against the bot at its tuned strength; a
   * real-time game is solo and has nothing to configure either way.
   *
   * `playNonce` is bumped so switching between two turn-based games remounts
   * the play screen — `useLocalPlayController` only initializes its session on
   * mount, so without it a switch would keep the previous game's session.
   */
  const quickStart = useCallback((item: GameItem): void => {
    if (item.kind === "realtime") {
      setRoute({ screen: "realtime", gameId: item.id });
      return;
    }
    const playerCount = GAME_CATALOG[item.id]?.playerCount ?? 2;
    setPlayNonce((nonce) => nonce + 1);
    setRoute({
      screen: "play",
      gameId: item.id,
      seats: presetSeats("bot", playerCount, item.id),
    });
  }, []);

  // MPG-077: online play (create or join a room) needs a username; local-only
  // play never touches this. Backing out of the picker while trying to join
  // an invite link sends the user home rather than leaving them stuck.
  const usernameGate = useUsernameGate(goHome);

  // MPG-025: `seats` is the Setup screen's real per-seat editor state (human/
  // bot + difficulty, any combination) — no longer hardcoded to "every seat
  // an open human". An all-bot config has no seat for the creator to hold,
  // so the room starts `active` immediately with nobody to invite — that's
  // the "watch" case, routed straight to the read-only watch screen instead
  // of the invite-link flow. Any config with at least one human seat is
  // unchanged from before (MPG-068's normal online-play flow).
  const handlePlayOnline = useCallback(
    (gameId: GameId, seats: SeatsConfig) => {
      usernameGate.requireUsername(() => {
        void createRoom(gameId, toSeatConfigInput(seats)).then((created) => {
          if (!created) return;
          if (typeof window !== "undefined") {
            window.history.pushState({}, "", `/${gameId}/room/${created.roomId}`);
          }
          if (isAllBotRoom(created)) {
            setRoute({ screen: "watch", gameId, roomId: created.roomId });
            return;
          }
          const inviteUrl = buildInviteUrl(gameId, created.roomId);
          setRoute({ screen: "invite", gameId, roomId: created.roomId, inviteUrl });
        });
      });
    },
    [createRoom, usernameGate],
  );

  // Session bootstrap (MPG-054, wired in MPG-080). Mints the opaque session
  // token once per browser so username sync, leaderboard writes and the socket
  // handshake all carry the same identity. Deliberately fire-and-forget: a
  // missing session is a degraded-but-valid state (local play vs bots still
  // works), so a server that is down or absent must never block first paint or
  // surface an error here.
  useEffect(() => {
    void initSession().catch(() => {
      // Intentionally swallowed — see above.
    });
  }, []);

  // Direct invite-link opens (`/:gameId/room/:roomId`) land straight on
  // "join" from `initialRoute()`, but the browser back/forward buttons can
  // also produce one — keep the route in sync with the URL either way.
  useEffect(() => {
    const onPopState = (): void => {
      const parsed = parseRoomPath(window.location.pathname);
      setRoute(
        parsed
          ? { screen: "join", gameId: parsed.gameId, roomId: parsed.roomId }
          : { screen: "home" },
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Opening an invite link directly also needs a username first — gate it
  // the same way, so `JoinScreen` never fires `room:join` before one exists.
  const joinRoomId = route.screen === "join" ? route.roomId : undefined;
  useEffect(() => {
    if (joinRoomId === undefined) return;
    usernameGate.requireUsername(() => {
      // No-op: JoinScreen itself performs the join once it's allowed to render.
    });
    // `requireUsername` is referentially stable (see `useUsernameGate`); only
    // re-run when a distinct invite link is opened.
  }, [joinRoomId, usernameGate.requireUsername]);

  return (
    <main className={styles.main}>
      <button
        type="button"
        className={styles.themeToggle}
        onClick={cycleTheme}
        aria-label={`Theme: ${THEME_LABEL[theme]}. Activate to switch theme.`}
      >
        Theme: {THEME_LABEL[theme]} ({resolvedTheme})
      </button>

      {route.screen === "home" ? (
        <HomeScreen
          games={games}
          realtimeGames={realtimeGames}
          {...(gameOfTheDayId ? { gameOfTheDay: gameOfTheDayId } : {})}
          onSelectGame={(gameId) => quickStart({ kind: "turn-based", id: gameId, title: gameId })}
          onSelectRealtimeGame={(gameId) => setRoute({ screen: "realtime", gameId })}
          onConfigureGame={(gameId) => setRoute({ screen: "setup", gameId })}
          onShowGallery={() => setRoute({ screen: "gallery" })}
          devMode={isDevMode()}
        />
      ) : null}

      {route.screen === "setup" ? (
        <SetupScreen
          gameId={route.gameId}
          onBack={goHome}
          onStart={(seats) => setRoute({ screen: "play", gameId: route.gameId, seats })}
          onPlayOnline={(seats) => handlePlayOnline(route.gameId, seats)}
        />
      ) : null}

      {route.screen === "invite" ? (
        <InviteScreen
          gameId={route.gameId}
          room={room}
          inviteUrl={route.inviteUrl}
          onCancel={() => {
            void leaveRoom();
            goHome();
          }}
          onReady={(readyRoom) => {
            setRoute({
              screen: "online-play",
              gameId: route.gameId,
              roomId: readyRoom.roomId,
              seats: publicRoomToSeats(readyRoom),
            });
          }}
        />
      ) : null}

      {route.screen === "join" ? (
        getStoredUsername() ? (
          <JoinScreen
            gameId={route.gameId}
            roomId={route.roomId}
            joinRoom={joinRoom}
            error={roomError}
            onBackHome={() => {
              clearRoomError();
              goHome();
            }}
            onJoined={(joinedRoom) => {
              setRoute({
                screen: "online-play",
                gameId: route.gameId,
                roomId: joinedRoom.roomId,
                seats: publicRoomToSeats(joinedRoom),
              });
            }}
          />
        ) : (
          // The username picker (rendered below, unconditionally) is open on
          // top of this — this is just the non-blank state behind it.
          <div className={styles.galleryWrap}>
            <p>Pick a username to join this game.</p>
          </div>
        )
      ) : null}

      {route.screen === "online-play" ? (
        <OnlineGameRoute
          key={route.roomId}
          gameId={route.gameId}
          seats={route.seats}
          roomId={route.roomId}
          yourSlot={yourSlot}
          sessionToken={sessionToken}
          initialRoom={room?.roomId === route.roomId ? room : undefined}
          onExit={() => {
            void leaveRoom();
            goHome();
          }}
          onRematchStart={(newRoomId) => {
            setRoute({
              screen: "online-play",
              gameId: route.gameId,
              roomId: newRoomId,
              seats: route.seats,
            });
          }}
          onViewLeaderboard={() => setRoute({ screen: "leaderboard", gameId: route.gameId })}
        />
      ) : null}

      {route.screen === "watch" ? (
        <WatchGameRoute
          key={route.roomId}
          gameId={route.gameId}
          roomId={route.roomId}
          creatorToken={creatorToken ?? getStoredCreatorToken(route.roomId)}
          initialRoom={room?.roomId === route.roomId ? room : undefined}
          onExit={goHome}
        />
      ) : null}

      {route.screen === "play" ? (
        <>
          <GameSwitcher items={gameItems} currentId={route.gameId} onSwitch={quickStart} />
          <GameRoute
            key={playNonce}
            gameId={route.gameId}
            seats={route.seats}
            onExit={() => {
              void leaveRoom();
              goHome();
            }}
            onPlayAgain={(seats) => {
              setPlayNonce((n) => n + 1);
              setRoute({ screen: "play", gameId: route.gameId, seats });
            }}
            onNextGame={() => {
              const next = nextGame(gameItems, route.gameId);
              if (next) quickStart(next);
            }}
            onViewLeaderboard={() => setRoute({ screen: "leaderboard", gameId: route.gameId })}
          />
        </>
      ) : null}

      {route.screen === "leaderboard" ? (
        <LeaderboardScreen
          gameId={route.gameId}
          gameTitle={
            GAME_CATALOG[route.gameId as GameId]?.title ??
            REALTIME_CATALOG[route.gameId as RealtimeGameId]?.title ??
            route.gameId
          }
          metric={
            REALTIME_CATALOG[route.gameId as RealtimeGameId]
              ? "score"
              : (LEADERBOARD_METRIC[route.gameId as GameId] ?? "wld")
          }
          onBack={goHome}
        />
      ) : null}

      {route.screen === "realtime" ? (
        <>
          <GameSwitcher items={gameItems} currentId={route.gameId} onSwitch={quickStart} />
          <RealtimeGameRoute
            key={route.gameId}
            gameId={route.gameId}
            onExit={() => setRoute({ screen: "home" })}
            onViewLeaderboard={() => setRoute({ screen: "leaderboard", gameId: route.gameId })}
          />
        </>
      ) : null}

      {route.screen === "shared" ? (
        <SharedResultScreen
          token={route.token}
          onBackHome={goHome}
          onPlayGame={(gameId) => {
            // The shared game may be from either family, so resolve it through
            // the same ordered catalog Home uses rather than guessing.
            const item = gameItems.find((candidate) => candidate.id === gameId);
            if (item) quickStart(item);
            else goHome();
          }}
          onViewLeaderboard={(gameId) =>
            setRoute({ screen: "leaderboard", gameId: gameId as GameId | RealtimeGameId })
          }
        />
      ) : null}

      {route.screen === "gallery" ? (
        <div className={styles.galleryWrap}>
          <Button variant="ghost" size="sm" onClick={() => setRoute({ screen: "home" })}>
            ← Back to home
          </Button>
          <UiGallery />
        </div>
      ) : null}

      <UsernamePrompt
        isOpen={usernameGate.isOpen}
        onSubmit={usernameGate.handleSubmit}
        onCancel={usernameGate.handleCancel}
        collisionMessage={usernameGate.collisionMessage}
      />

      <footer className={styles.footer}>Created by Bharat Kandpal</footer>
    </main>
  );
}
