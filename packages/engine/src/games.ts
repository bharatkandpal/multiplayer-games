// Wiring between concrete game modules and the registry. Connect Four joins
// `builtInGames` in MPG-006.

import { registerGame } from "./registry";
import { ticTacToe } from "./tictactoe";

/** All game modules shipped with the platform. */
export const builtInGames = [ticTacToe];

/** Register every built-in game. Call once at platform startup. */
export function registerBuiltInGames(): void {
  for (const game of builtInGames) {
    registerGame(game);
  }
}
