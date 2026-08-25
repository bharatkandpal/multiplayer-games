import { useMemo } from "react";
import { ENGINE_VERSION, registerBuiltInGames, listGames, hasGame } from "@mpg/engine";

// Registering is idempotent-safe to call once at module scope: React's dev-mode
// double-invocation of components must not throw on a second registration.
if (!hasGame("tictactoe") && !hasGame("connect4")) {
  registerBuiltInGames();
}

/**
 * Minimal app shell for MPG-029-a. Proves the Vite + React + TS scaffold and the
 * `@mpg/engine` workspace link are wired up. No design system / tokens here yet
 * (MPG-029-b/c); plain markup only.
 */
export default function App(): React.JSX.Element {
  const games = useMemo(() => listGames(), []);

  return (
    <main>
      <h1>Multiplayer Games</h1>
      <p>
        Engine version: <code>{ENGINE_VERSION}</code>
      </p>
      <p>Available games:</p>
      <ul aria-label="Available games">
        {games.map((id) => (
          <li key={id}>{id}</li>
        ))}
      </ul>
    </main>
  );
}
