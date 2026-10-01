import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  BrandBar,
  Button,
  ChatIcon,
  ClaimHandlePrompt,
  ThemeSwitch,
  UsernamePrompt,
} from "./components/ui";
import { cx } from "./components/ui/cx";
import {
  ChatScreen,
  ConnectFourOnlineRoute,
  ConnectFourRoute,
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
  TicTacToeOnlineRoute,
  TicTacToeRoute,
  type GameRouteProps,
  type OnlineGameRouteProps,
} from "./screens";
import { GAME_CATALOG, REALTIME_CATALOG } from "./screens/HomeScreen";
import { SharedResultScreen } from "./screens/SharedResultScreen";
import { buildGameItems, nextGame, prevGame, type GameItem } from "./screens/catalog";
import { pickGameOfTheDay } from "./screens/gameOfTheDay";
import { DEFAULT_CHAT_ROOM_ID, isPrivateRoomSearch, roomPath } from "./screens/chatRoom";
import { parseInviteSecret } from "./api/gameInvite";
import { loadGameRoom } from "./api/gameRoomStorage";
import { ensureUsername, getStoredUsername, reconcileUsername } from "./api/username";
import { initSession } from "./api/session";
import { installFlushOnHide } from "./api/events";
import { markColdArrival } from "./analytics/firstInput";
import { useOnlineGame } from "./hooks/useOnlineGame";
import { useVisualViewportBox } from "./hooks/useVisualViewportBox";
import { useUsernameGate } from "./hooks/useUsernameGate";
import { useClaimGate } from "./hooks/useClaimGate";
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
  // MPG-087: `challenge` carries a score to beat when the player arrived from a
  // friend's shared result via "Beat this score" — the realtime play surface
  // shows it as a target and turns the result into "you beat the challenge".
  | { screen: "realtime"; gameId: RealtimeGameId; challenge?: { score: number } }
  | { screen: "gallery" }
  // MPG-012: the room creator waits here for the invite link to be opened
  // (reworked onto peer-to-peer Ably play — `useOnlineGame`, no server room).
  | { screen: "invite"; gameId: GameId; roomId: string }
  // MPG-012: an invite link (`/:gameId/room/:roomId#s=...`) was opened
  // directly. `secret` is the fragment's payload — `undefined` for a
  // malformed link (`JoinScreen` shows a friendly failure, never a crash).
  | { screen: "join"; gameId: GameId; roomId: string; secret: string | undefined }
  // MPG-068: the peer's presence has been seen (or this browser is resuming
  // its own stored room after a reload) — play over `useOnlineGame` instead
  // of the local engine. `seats` is a fixed 2-human snapshot (online play is
  // human-vs-human only, CLAUDE.md) for the seat row.
  | { screen: "online-play"; gameId: GameId; roomId: string; seats: SeatsConfig }
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

/**
 * The chat overlay's state (CHAT-024). Chat is no longer a screen you navigate
 * *to* — it rides as an overlay over whatever screen is underneath (a game keeps
 * running below it), toggled by a floating button and collapsed back to it. A
 * `/chat` (or room-share) deep link still works: it opens this overlay over Home
 * rather than replacing the page. `private` (CHAT-020, set by a `?p=1` link)
 * makes the room prompt for a shared secret first.
 */
interface ChatOverlayState {
  open: boolean;
  roomId: string;
  private: boolean;
}

/**
 * The screens that are a *game*, not a page: a top bar, the board or play
 * surface, and the pinned action bar, with no site chrome below them
 * (MPG-136).
 */
const IN_GAME_SCREENS = new Set<Route["screen"]>(["play", "realtime", "online-play"]);

const ROOM_PATH_RE = /^\/([^/]+)\/room\/([^/]+)\/?$/;
const SHARE_PATH_RE = /^\/s\/([^/]+)\/?$/;
const GAME_SLUG_RE = /^\/([^/]+)\/?$/;
const CHAT_PATH_RE = /^\/chat(?:\/([^/]+))?\/?$/;

/**
 * Parses `/chat` or `/chat/:roomId` out of a pathname (CHAT-004), reading the
 * `?p=1` private-room marker (CHAT-020) off the search string when given.
 */
function parseChatPath(
  pathname: string,
  search = "",
): { roomId: string; private: boolean } | undefined {
  const match = CHAT_PATH_RE.exec(pathname);
  if (!match) return undefined;
  const roomId = match[1];
  return {
    roomId: roomId ? decodeURIComponent(roomId) : DEFAULT_CHAT_ROOM_ID,
    private: isPrivateRoomSearch(search),
  };
}

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

/**
 * Reads a `?challenge=<score>` rider off a deep link (MPG-087). This is how a
 * shared score travels when no durable `/s/:token` could be minted: the score
 * itself rides in the URL (see `buildShareUrl`), needing no backend to resolve.
 * Only a real, non-negative number counts — anything else (missing, blank, NaN,
 * negative) is ignored, so a malformed link degrades to just opening the game.
 */
function parseChallengeScore(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("challenge");
  if (raw === null || raw.trim() === "") return undefined;
  const score = Number(raw);
  return Number.isFinite(score) && score >= 0 ? score : undefined;
}

/**
 * Parses a bare `/:gameId` deep link into the route that OPENS that game
 * (MPG-087). This is the destination the shared score link points at when no
 * durable `/s/:token` could be minted (the offline / backend-down fallback in
 * `buildShareUrl`): "here's the game" has to actually land IN the game, not on
 * Home. It needs no session and no network — a real-time game goes straight to
 * its solo play surface (with the shared score as a "Beat this score" target
 * when the link carries one); a turn-based game opens quick-started against the
 * bot, exactly as tapping it on Home would. Returns `undefined` for anything
 * that isn't a registered game id, so unknown single-segment paths fall to Home.
 */
function parseGameSlug(pathname: string, search = ""): Route | undefined {
  const match = GAME_SLUG_RE.exec(pathname);
  const slug = match?.[1];
  if (!slug) return undefined;
  const gameId = decodeURIComponent(slug);
  if (hasRealtimeGame(gameId as RealtimeGameId)) {
    // Only real-time games are scored, so only they carry a challenge target —
    // and only when the link actually has one, so an ordinary `/floppy-birds`
    // still opens a plain run.
    const challengeScore = parseChallengeScore(search);
    return {
      screen: "realtime",
      gameId: gameId as RealtimeGameId,
      ...(challengeScore !== undefined ? { challenge: { score: challengeScore } } : {}),
    };
  }
  if (hasGame(gameId as GameId)) {
    const playerCount = GAME_CATALOG[gameId as GameId]?.playerCount ?? 2;
    return {
      screen: "play",
      gameId: gameId as GameId,
      seats: presetSeats("bot", playerCount, gameId),
    };
  }
  return undefined;
}

function initialRoute(): Route {
  if (typeof window === "undefined") return { screen: "home" };
  // A share link is checked FIRST: it is the one entry point reached by people
  // who have never used the app, so it must not fall through to Home.
  const shareToken = parseSharePath(window.location.pathname);
  if (shareToken) {
    // MPG-097 leg 5: start the time-to-first-input clock here, at the only
    // entry point a stranger can arrive through.
    markColdArrival();
    return { screen: "shared", token: shareToken };
  }
  // A `/chat` deep link doesn't get its own screen anymore — it opens the chat
  // overlay (see `initialChat`) over Home, so the underlying screen here is just
  // Home. Fall through to the room/slug/home resolution below.
  const parsed = parseRoomPath(window.location.pathname);
  if (!parsed) {
    // A bare `/:gameId` deep link — the fallback a shared score link uses when
    // no durable `/s/:token` exists. Open the game directly (and count the
    // cold arrival, same as a share link: a stranger can land here too).
    const slugRoute = parseGameSlug(window.location.pathname, window.location.search);
    if (slugRoute) {
      markColdArrival();
      return slugRoute;
    }
    return { screen: "home" };
  }
  // A reload of a room THIS browser already has local progress in (creator or
  // joiner alike — `../api/gameRoomStorage.ts` persists on every move, not
  // just for the creator) resumes straight into the game rather than
  // re-running the join flow; its secret comes from local storage, so the
  // URL doesn't need to carry it for this browser to recover.
  const stored = loadGameRoom(parsed.roomId);
  if (stored && stored.gameId === parsed.gameId) {
    return {
      screen: "online-play",
      gameId: parsed.gameId,
      roomId: parsed.roomId,
      seats: ONLINE_SEATS,
    };
  }
  // Otherwise this is an invite link someone opened — the secret rides the
  // URL fragment (`../api/gameInvite.ts`); missing/malformed degrades to a
  // friendly failure in `JoinScreen`, never a crash.
  return {
    screen: "join",
    gameId: parsed.gameId,
    roomId: parsed.roomId,
    secret: parseInviteSecret(window.location.hash),
  };
}

/** The overlay's resting state — closed, on the default room. */
const CLOSED_CHAT: ChatOverlayState = {
  open: false,
  roomId: DEFAULT_CHAT_ROOM_ID,
  private: false,
};

/**
 * The chat overlay's initial state from the URL (CHAT-024): a `/chat` (or
 * `/chat/:roomId`, `?p=1`) deep link opens the overlay straight away, on that
 * room; anything else starts closed on the default room.
 */
function initialChat(): ChatOverlayState {
  if (typeof window === "undefined") return CLOSED_CHAT;
  const chatPath = parseChatPath(window.location.pathname, window.location.search);
  if (!chatPath) return CLOSED_CHAT;
  return { open: true, roomId: chatPath.roomId, private: chatPath.private };
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

/** Online play is human-vs-human only (CLAUDE.md — bot seats never leave this device). */
const ONLINE_SEATS: SeatsConfig = [{ kind: "human" }, { kind: "human" }];

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
  navigation,
}: { gameId: GameId } & GameRouteProps): React.JSX.Element {
  const Route = GAME_ROUTES[gameId] ?? ConnectFourRoute;
  return (
    <Route
      seats={seats}
      onExit={onExit}
      {...(onPlayAgain ? { onPlayAgain } : {})}
      {...(onNextGame ? { onNextGame } : {})}
      {...(onViewLeaderboard ? { onViewLeaderboard } : {})}
      {...(navigation ? { navigation } : {})}
    />
  );
}

// MPG-068 (reworked onto peer-to-peer Ably play): the online counterpart to
// `GAME_ROUTES`/`GameRoute` — drives gameplay over `useOnlineGame` instead of
// a local engine.
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
  const { resolvedTheme, setTheme } = useTheme();
  const [route, setRoute] = useState<Route>(initialRoute);
  // MPG-050: `useLocalPlayController` only (re-)initializes its session on
  // mount, so starting a genuinely fresh game (different opponents, not a
  // same-seats Rematch) needs the whole play screen to remount rather than
  // just receiving new `seats` props. Bumped every time a fresh game starts
  // and folded into the route's React `key` below.
  const [playNonce, setPlayNonce] = useState(0);

  // MPG-012/MPG-068: the whole online-play lifecycle (create/join/leave,
  // live game state), reworked onto peer-to-peer Ably play. A single shared
  // instance — only one online room is ever "current" for this tab at a time.
  const online = useOnlineGame();

  // CHAT-024: the chat overlay, layered over whatever screen is active. Kept out
  // of `route` on purpose — the screen underneath (a live game especially) must
  // stay mounted while chat is open, so this is its own bit of state.
  const [chat, setChat] = useState<ChatOverlayState>(initialChat);
  // The path to restore when the overlay is dismissed. Opening chat pushes a
  // `/chat` history entry (so the panel is shareable and the back button closes
  // it); collapsing returns to whatever was showing underneath.
  const chatReturnPathRef = useRef(
    typeof window !== "undefined" && !chat.open
      ? window.location.pathname + window.location.search
      : "/",
  );
  // Pin the full-screen chat sheet to the visual viewport so a phone's soft
  // keyboard shrinks it from the bottom instead of pushing its header off the
  // top (see useVisualViewportBox).
  const chatOverlayRef = useRef<HTMLDivElement>(null);
  useVisualViewportBox(chatOverlayRef, chat.open);

  const goHome = useCallback((): void => {
    setRoute({ screen: "home" });
    if (typeof window !== "undefined") window.history.pushState({}, "", "/");
  }, []);

  const openChat = useCallback((): void => {
    setChat((prev) => {
      const next = { ...prev, open: true };
      if (typeof window !== "undefined") {
        chatReturnPathRef.current = window.location.pathname + window.location.search;
        window.history.pushState({}, "", roomPath(next.roomId, { private: next.private }));
      }
      return next;
    });
  }, []);

  const closeChat = useCallback((): void => {
    setChat((prev) => ({ ...prev, open: false }));
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", chatReturnPathRef.current || "/");
    }
  }, []);

  // Switch rooms from inside the overlay. `replaceState` (not push) keeps the
  // URL shareable — so "Share room" copies the right link — without stacking a
  // history entry per room hop; the single `/chat` entry from `openChat` is what
  // the back button collapses.
  const openChatRoom = useCallback((roomId: string, opts?: { private?: boolean }): void => {
    const isPrivate = opts?.private ?? false;
    setChat({ open: true, roomId, private: isPrivate });
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", roomPath(roomId, { private: isPrivate }));
    }
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

  /**
   * MPG-136: the prev/next entries for the play screens' pinned action bar.
   * Walks the same ordered catalog Home uses and wraps at both ends
   * (`prevGame`/`nextGame`), so with 2+ games neither side is ever a dead
   * control — and with a single-game catalog both are absent and the bar
   * renders nothing rather than two disabled arrows.
   *
   * Switching quick-starts the neighbour exactly as tapping it on Home would,
   * so moving between games never routes through setup.
   */
  const navigationFor = useCallback(
    (gameId: GameId | RealtimeGameId) => {
      const previous = prevGame(gameItems, gameId);
      const next = nextGame(gameItems, gameId);
      return {
        ...(previous
          ? { previous: { title: previous.title, onSelect: () => quickStart(previous) } }
          : {}),
        ...(next ? { next: { title: next.title, onSelect: () => quickStart(next) } } : {}),
      };
    },
    [gameItems, quickStart],
  );

  // MPG-077: online play (create or join a room) needs a username; local-only
  // play never touches this. Backing out of the picker while trying to join
  // an invite link sends the user home rather than leaving them stuck.
  const usernameGate = useUsernameGate(goHome);

  // MPG-091-c: after a value moment (a win or a leaderboard-worthy score, fired
  // via `noteValueMoment`), offer a non-blocking prompt to claim a durable
  // handle. Entirely an enhancement — the gate only opens when a boot probe
  // confirmed the backend is reachable and this session hasn't claimed, so a
  // backend that's down simply never offers it (offline pillar).
  const claimGate = useClaimGate();

  // MPG-012 (reworked onto peer-to-peer Ably play): creates a room and opens
  // the invite-link flow. Online play is always exactly 2 human seats
  // (`SetupScreen` only offers/calls this for an all-human config — bots stay
  // local-only, CLAUDE.md), so `seats` isn't threaded through room creation
  // at all here; it's only read back out as `ONLINE_SEATS` once play starts.
  const handlePlayOnline = useCallback(
    (gameId: GameId) => {
      usernameGate.requireUsername(() => {
        const created = online.createRoom(gameId);
        if (typeof window !== "undefined") {
          window.history.pushState({}, "", `/${gameId}/room/${created.roomId}`);
        }
        setRoute({ screen: "invite", gameId, roomId: created.roomId });
      });
    },
    [online, usernameGate],
  );

  // Landing directly on "online-play" — a hard reload of a room this browser
  // already has local progress in (`initialRoute`/the popstate handler both
  // route there straight from `../api/gameRoomStorage.ts`, skipping Invite/
  // Join) — still needs `useOnlineGame` actually connected to that room; its
  // secret comes back out of the same local record rather than the URL.
  useEffect(() => {
    if (route.screen !== "online-play") return;
    if (online.roomId === route.roomId) return;
    const stored = loadGameRoom(route.roomId);
    if (stored && stored.gameId === route.gameId) {
      online.joinRoom(route.gameId, route.roomId, stored.secret);
    } else {
      // Nothing to resume from (storage was cleared, a different browser,
      // …) — there's no session to recover, so don't strand the player on a
      // blank play screen.
      goHome();
    }
  }, [route, online, goHome]);

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

  // Auto-assign a friendly default username (an adjective+animal like
  // `strongWolf`) the instant the site opens, so a first-time visitor never
  // meets an empty name box — and online play, the leaderboard, and share
  // cards all have something to show immediately. Purely local and synchronous;
  // the best-effort uniqueness sync is fire-and-forget and silently regenerates
  // on a genuine collision (see `reconcileUsername`/`syncUsername`). A name the
  // player already has — chosen or previously auto-assigned — is left untouched.
  useEffect(() => {
    ensureUsername();
    void reconcileUsername();
  }, []);

  // MPG-097: flush queued funnel events when the page goes away. Same
  // fire-and-forget posture as the session bootstrap above — a visitor who
  // bounces in under the flush interval is exactly the datapoint worth
  // keeping, and losing it silently is the worst outcome available here.
  useEffect(() => installFlushOnHide(), []);

  // Direct invite-link opens (`/:gameId/room/:roomId`) land straight on
  // "join" from `initialRoute()`, but the browser back/forward buttons can
  // also produce one — keep the route in sync with the URL either way.
  useEffect(() => {
    const onPopState = (): void => {
      // A chat URL toggles the overlay, not the screen underneath — so back/
      // forward across the `/chat` entry opens or closes the panel while the
      // game or page beneath it stays exactly where it was.
      const chatPath = parseChatPath(window.location.pathname, window.location.search);
      if (chatPath) {
        setChat({ open: true, roomId: chatPath.roomId, private: chatPath.private });
        return;
      }
      setChat((prev) => (prev.open ? { ...prev, open: false } : prev));
      const parsed = parseRoomPath(window.location.pathname);
      if (parsed) {
        const stored = loadGameRoom(parsed.roomId);
        if (stored && stored.gameId === parsed.gameId) {
          setRoute({
            screen: "online-play",
            gameId: parsed.gameId,
            roomId: parsed.roomId,
            seats: ONLINE_SEATS,
          });
          return;
        }
        setRoute({
          screen: "join",
          gameId: parsed.gameId,
          roomId: parsed.roomId,
          secret: parseInviteSecret(window.location.hash),
        });
        return;
      }
      // Keep bare `/:gameId` deep links working under back/forward too, not just
      // on a cold load (mirrors `initialRoute`).
      setRoute(
        parseGameSlug(window.location.pathname, window.location.search) ?? { screen: "home" },
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Opening an invite link directly also needs a username first — gate it
  // the same way, so `JoinScreen` never starts joining before one exists.
  const joinRoomId = route.screen === "join" ? route.roomId : undefined;
  useEffect(() => {
    if (joinRoomId === undefined) return;
    usernameGate.requireUsername(() => {
      // No-op: JoinScreen itself performs the join once it's allowed to render.
    });
    // `requireUsername` is referentially stable (see `useUsernameGate`); only
    // re-run when a distinct invite link is opened.
  }, [joinRoomId, usernameGate.requireUsername]);

  // MPG-136/137: an in-game screen is a frame, not a page — it carries only its
  // own top bar, the board and the pinned action bar.
  const inGame = IN_GAME_SCREENS.has(route.screen);
  // Chat no longer takes over the canvas (CHAT-024) — it rides above whatever
  // screen is active as an overlay — so the frame treatment is purely about
  // whether the underlying screen is a game.
  const frame = inGame;

  return (
    <main className={styles.main}>
      {/* MPG-137: the theme switch is site chrome. In-game its height is board
          height, and the top bar is spoken for (Home + title + Rules,
          UX_PRINCIPLES §9) — so it's offered on every page screen and withheld
          from the frame, exactly like the footer credit below. */}
      {frame ? null : (
        <div className={styles.chromeBar}>
          {route.screen === "home" ? (
            // MPG-145: Home's bar carries the brand; the MPG-147 avatar joins the
            // switch in this same trailing slot.
            <BrandBar>
              <ThemeSwitch dark={resolvedTheme === "dark"} onChange={(next) => setTheme(next)} />
            </BrandBar>
          ) : (
            <ThemeSwitch dark={resolvedTheme === "dark"} onChange={(next) => setTheme(next)} />
          )}
        </div>
      )}

      {/* MPG-137: the one scrolling region. A page screen scrolls in here; an
          in-game screen doesn't scroll at all. Either way the page itself is
          pinned to the viewport, so no control can scroll out of reach. */}
      <div className={cx(styles.screen, frame && styles.screenInGame)}>
        {route.screen === "home" ? (
          <HomeScreen
            games={games}
            realtimeGames={realtimeGames}
            {...(gameOfTheDayId ? { gameOfTheDay: gameOfTheDayId } : {})}
            onSelectGame={(gameId) => quickStart({ kind: "turn-based", id: gameId, title: gameId })}
            onSelectRealtimeGame={(gameId) => setRoute({ screen: "realtime", gameId })}
            onConfigureGame={(gameId) => setRoute({ screen: "setup", gameId })}
            onOpenChat={openChat}
            onShowGallery={() => setRoute({ screen: "gallery" })}
            devMode={isDevMode()}
          />
        ) : null}

        {route.screen === "setup" ? (
          <SetupScreen
            gameId={route.gameId}
            onBack={goHome}
            onStart={(seats) => setRoute({ screen: "play", gameId: route.gameId, seats })}
            onPlayOnline={() => handlePlayOnline(route.gameId)}
          />
        ) : null}

        {route.screen === "invite" ? (
          <InviteScreen
            gameId={route.gameId}
            inviteUrl={online.inviteUrl ?? ""}
            peerConnected={online.peerConnected}
            unavailable={online.phase === "unavailable"}
            onCancel={() => {
              online.leaveRoom();
              goHome();
            }}
            onReady={() => {
              setRoute({
                screen: "online-play",
                gameId: route.gameId,
                roomId: route.roomId,
                seats: ONLINE_SEATS,
              });
            }}
          />
        ) : null}

        {route.screen === "join" ? (
          getStoredUsername() ? (
            <JoinScreen
              gameId={route.gameId}
              roomId={route.roomId}
              secret={route.secret}
              joinRoom={(roomId, secret) => online.joinRoom(route.gameId, roomId, secret)}
              onBackHome={goHome}
              onJoined={() => {
                setRoute({
                  screen: "online-play",
                  gameId: route.gameId,
                  roomId: route.roomId,
                  seats: ONLINE_SEATS,
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
            online={online}
            onExit={() => {
              online.leaveRoom();
              goHome();
            }}
            onViewLeaderboard={() => setRoute({ screen: "leaderboard", gameId: route.gameId })}
          />
        ) : null}

        {route.screen === "play" ? (
          <GameRoute
            key={playNonce}
            gameId={route.gameId}
            seats={route.seats}
            navigation={navigationFor(route.gameId)}
            onExit={() => {
              online.leaveRoom();
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
          <RealtimeGameRoute
            // Keyed on the challenge too so arriving on a target (or switching
            // off one) remounts to a clean run rather than reusing loop state.
            key={`${route.gameId}:${route.challenge?.score ?? ""}`}
            gameId={route.gameId}
            navigation={navigationFor(route.gameId)}
            onExit={() => setRoute({ screen: "home" })}
            onViewLeaderboard={() => setRoute({ screen: "leaderboard", gameId: route.gameId })}
            {...(route.challenge ? { challenge: route.challenge } : {})}
          />
        ) : null}

        {route.screen === "shared" ? (
          <SharedResultScreen
            token={route.token}
            onBackHome={goHome}
            onPlayGame={(gameId, challengeScore) => {
              // The shared game may be from either family, so resolve it through
              // the same ordered catalog Home uses rather than guessing.
              const item = gameItems.find((candidate) => candidate.id === gameId);
              if (!item) {
                goHome();
                return;
              }
              // A "Beat this score" arrival (MPG-087): only real-time games are
              // scored, so a challenge routes straight to the realtime surface
              // with the target. Anything else just opens the game normally.
              if (typeof challengeScore === "number" && item.kind === "realtime") {
                setRoute({
                  screen: "realtime",
                  gameId: item.id,
                  challenge: { score: challengeScore },
                });
                return;
              }
              quickStart(item);
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

        {/* MPG-136/137: the credit is site chrome, and an in-game screen has
            none — it ends at the pinned action bar (UX_PRINCIPLES §9: the
            screen is the frame, and the bar is its bottom edge). On a page
            screen it sits below the content, inside the scrolling region. */}
        {frame ? null : <footer className={styles.footer}>created by BK with ❤️</footer>}
      </div>

      {/* CHAT-024: chat rides above every screen. The floating toggle opens it;
          the overlay itself is a full-screen sheet on a phone and a docked side
          panel on a wide screen (so a game stays visible and playable beside
          it), collapsing back to the toggle. Chat is an enhancement layered on
          the game (CLAUDE.md offline pillar): the panel connects lazily and, if
          chat's backend is down, degrades to a quiet "unavailable" inside — it
          never blocks or covers the game it floats over. */}
      {chat.open ? null : (
        <button
          type="button"
          // In-game the bottom-right corner belongs to the pinned action bar
          // (prev/opponent/next), so the toggle lifts clear of it rather than
          // sitting on the "next game" control.
          className={cx(styles.chatFab, inGame && styles.chatFabInGame)}
          onClick={openChat}
          aria-label="Open chat"
        >
          <ChatIcon className={styles.chatFabIcon} />
        </button>
      )}

      {chat.open ? (
        <div
          ref={chatOverlayRef}
          className={styles.chatOverlay}
          role="dialog"
          aria-modal="false"
          aria-label="Chat"
        >
          <div className={styles.chatPanel}>
            <ChatScreen
              // Keep private/public variants of one room as distinct mounts, so a
              // switch re-reads the stored secret (CHAT-020) rather than reusing
              // stale locked/unlocked state.
              key={`${chat.roomId}:${chat.private ? "private" : "public"}`}
              roomId={chat.roomId}
              isPrivate={chat.private}
              toolbar={
                <ThemeSwitch dark={resolvedTheme === "dark"} onChange={(next) => setTheme(next)} />
              }
              onBack={closeChat}
              onOpenRoom={openChatRoom}
            />
          </div>
        </div>
      ) : null}

      <UsernamePrompt
        isOpen={usernameGate.isOpen}
        onSubmit={usernameGate.handleSubmit}
        onCancel={usernameGate.handleCancel}
        collisionMessage={usernameGate.collisionMessage}
      />

      <ClaimHandlePrompt
        isOpen={claimGate.isOpen}
        view={claimGate.view}
        recoveryCode={claimGate.recoveryCode}
        claimedHandle={claimGate.claimedHandle}
        claimError={claimGate.claimError}
        adoptError={claimGate.adoptError}
        submitting={claimGate.submitting}
        onSubmitClaim={claimGate.submitClaim}
        onSubmitAdopt={claimGate.submitAdopt}
        onConfirmSaved={claimGate.confirmSaved}
        onSwitchToAdopt={claimGate.switchToAdopt}
        onSwitchToClaim={claimGate.switchToClaim}
        onCancel={claimGate.cancel}
      />
    </main>
  );
}
