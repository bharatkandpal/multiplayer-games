import { useMemo, useState } from "react";
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
import { Button } from "./components/ui";
import {
  ConnectFourRoute,
  HomeScreen,
  RealtimeGameRoute,
  SetupScreen,
  TicTacToeMoveRoute,
  TicTacToeRoute,
  type GameRouteProps,
} from "./screens";
import type { SeatsConfig } from "./game";
import styles from "./App.module.css";

// Registering is idempotent-safe to call once at module scope: React's dev-mode
// double-invocation of components must not throw on a second registration.
if (!hasGame("tictactoe") && !hasGame("connect4")) {
  registerBuiltInGames();
}
if (!hasRealtimeGame("floppy-birds")) {
  registerBuiltInRealtimeGames();
}

type Route =
  | { screen: "home" }
  | { screen: "setup"; gameId: GameId }
  | { screen: "play"; gameId: GameId; seats: SeatsConfig }
  // Real-time (solo arcade) games skip Setup entirely — nothing to configure
  // for a solo run — and go straight to the realtime play surface (ADR 0002 §2).
  | { screen: "realtime"; gameId: RealtimeGameId }
  | { screen: "gallery" };

const THEME_LABEL: Record<ReturnType<typeof useTheme>["theme"], string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const GAME_ROUTES: Partial<Record<GameId, (props: GameRouteProps) => React.JSX.Element>> = {
  tictactoe: TicTacToeRoute,
  "tictactoe-move": TicTacToeMoveRoute,
  connect4: ConnectFourRoute,
};

function GameRoute({
  gameId,
  seats,
  onExit,
  onPlayAgain,
}: { gameId: GameId } & GameRouteProps): React.JSX.Element {
  const Route = GAME_ROUTES[gameId] ?? ConnectFourRoute;
  return <Route seats={seats} onExit={onExit} {...(onPlayAgain ? { onPlayAgain } : {})} />;
}

/**
 * App shell: a lightweight, state-driven router (Home → Setup → Play) plus the
 * persistent theme toggle. Home is the default view — the design-system kit
 * (MPG-029-c) is still reachable via a secondary link, not the default screen.
 */
export default function App(): React.JSX.Element {
  const games = useMemo(() => listGames(), []);
  const realtimeGames = useMemo(() => listRealtimeGames(), []);
  const { theme, resolvedTheme, cycleTheme } = useTheme();
  const [route, setRoute] = useState<Route>({ screen: "home" });
  // MPG-050: `useLocalPlayController` only (re-)initializes its session on
  // mount, so starting a genuinely fresh game (different opponents, not a
  // same-seats Rematch) needs the whole play screen to remount rather than
  // just receiving new `seats` props. Bumped every time a fresh game starts
  // and folded into the route's React `key` below.
  const [playNonce, setPlayNonce] = useState(0);

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
          onSelectGame={(gameId) => setRoute({ screen: "setup", gameId })}
          onSelectRealtimeGame={(gameId) => setRoute({ screen: "realtime", gameId })}
          onShowGallery={() => setRoute({ screen: "gallery" })}
        />
      ) : null}

      {route.screen === "setup" ? (
        <SetupScreen
          gameId={route.gameId}
          onBack={() => setRoute({ screen: "home" })}
          onStart={(seats) => setRoute({ screen: "play", gameId: route.gameId, seats })}
        />
      ) : null}

      {route.screen === "play" ? (
        <GameRoute
          key={playNonce}
          gameId={route.gameId}
          seats={route.seats}
          onExit={() => setRoute({ screen: "home" })}
          onPlayAgain={(seats) => {
            setPlayNonce((n) => n + 1);
            setRoute({ screen: "play", gameId: route.gameId, seats });
          }}
        />
      ) : null}

      {route.screen === "realtime" ? (
        <RealtimeGameRoute gameId={route.gameId} onExit={() => setRoute({ screen: "home" })} />
      ) : null}

      {route.screen === "gallery" ? (
        <div className={styles.galleryWrap}>
          <Button variant="ghost" size="sm" onClick={() => setRoute({ screen: "home" })}>
            ← Back to home
          </Button>
          <UiGallery />
        </div>
      ) : null}
    </main>
  );
}
