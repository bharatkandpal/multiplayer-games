import { useMemo, useState } from "react";
import { hasGame, listGames, registerBuiltInGames } from "@mpg/engine";
import type { GameId } from "@mpg/engine";
import { useTheme } from "./lib/useTheme";
import { UiGallery } from "./components/UiGallery";
import { Button } from "./components/ui";
import {
  ConnectFourRoute,
  HomeScreen,
  SetupScreen,
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

type Route =
  | { screen: "home" }
  | { screen: "setup"; gameId: GameId }
  | { screen: "play"; gameId: GameId; seats: SeatsConfig }
  | { screen: "gallery" };

const THEME_LABEL: Record<ReturnType<typeof useTheme>["theme"], string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function GameRoute({
  gameId,
  seats,
  onExit,
}: { gameId: GameId } & GameRouteProps): React.JSX.Element {
  return gameId === "tictactoe" ? (
    <TicTacToeRoute seats={seats} onExit={onExit} />
  ) : (
    <ConnectFourRoute seats={seats} onExit={onExit} />
  );
}

/**
 * App shell: a lightweight, state-driven router (Home → Setup → Play) plus the
 * persistent theme toggle. Home is the default view — the design-system kit
 * (MPG-029-c) is still reachable via a secondary link, not the default screen.
 */
export default function App(): React.JSX.Element {
  const games = useMemo(() => listGames(), []);
  const { theme, resolvedTheme, cycleTheme } = useTheme();
  const [route, setRoute] = useState<Route>({ screen: "home" });

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
          onSelectGame={(gameId) => setRoute({ screen: "setup", gameId })}
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
          gameId={route.gameId}
          seats={route.seats}
          onExit={() => setRoute({ screen: "home" })}
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
    </main>
  );
}
