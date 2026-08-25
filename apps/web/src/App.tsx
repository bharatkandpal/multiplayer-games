import { useMemo } from "react";
import { ENGINE_VERSION, registerBuiltInGames, listGames, hasGame } from "@mpg/engine";
import { useTheme } from "./lib/useTheme";
import { UiGallery } from "./components/UiGallery";
import styles from "./App.module.css";

// Registering is idempotent-safe to call once at module scope: React's dev-mode
// double-invocation of components must not throw on a second registration.
if (!hasGame("tictactoe") && !hasGame("connect4")) {
  registerBuiltInGames();
}

const THEME_LABEL: Record<ReturnType<typeof useTheme>["theme"], string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * App shell. Proves the Vite + React + TS scaffold and the `@mpg/engine`
 * workspace link are wired up, and demonstrates the design-token layer
 * (MPG-029-b: colors, type, spacing, motion, light/dark theming) driving
 * real, if minimal, UI via CSS Modules, and renders the core component
 * library (MPG-029-c: Button/StatusBadge/Toast/Modal/Skeleton) via
 * `<UiGallery>` so it's exercised with real tokens/theming, not just tests.
 */
export default function App(): React.JSX.Element {
  const games = useMemo(() => listGames(), []);
  const { theme, resolvedTheme, cycleTheme } = useTheme();

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
      <h1 className={styles.heading}>Multiplayer Games</h1>
      <p>
        Engine version: <code>{ENGINE_VERSION}</code>
      </p>
      <p>Available games:</p>
      <ul aria-label="Available games" className={styles.gameList}>
        {games.map((id) => (
          <li key={id}>{id}</li>
        ))}
      </ul>
      <div className={styles.playerSwatches}>
        <span className={`${styles.playerSwatch} ${styles.player1}`}>
          <span className={styles.playerSwatchMark} aria-hidden="true" />
          Player 1
        </span>
        <span className={`${styles.playerSwatch} ${styles.player2}`}>
          <span className={styles.playerSwatchMark} aria-hidden="true" />
          Player 2
        </span>
      </div>
      <UiGallery />
    </main>
  );
}
