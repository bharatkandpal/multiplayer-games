// Wiring between concrete game modules and the registry.

import { registerGame } from "./registry";
import { connectFour } from "./connect4";
import { ticTacToe } from "./tictactoe";

/** All game modules shipped with the platform. */
export const builtInGames = [ticTacToe, connectFour];

/** Register every built-in game. Call once at platform startup. */
export function registerBuiltInGames(): void {
  for (const game of builtInGames) {
    registerGame(game);
  }
}
