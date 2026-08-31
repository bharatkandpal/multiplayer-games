// Wiring between concrete game modules and the registry.

import { registerGame } from "./registry";
import { connectFour } from "./connect4";
import { ticTacToe } from "./tictactoe";
import { ticTacToeMove } from "./tictactoe-move";
import { nim } from "./nim";
import { gomoku } from "./gomoku";

/** All game modules shipped with the platform. */
export const builtInGames = [ticTacToe, ticTacToeMove, connectFour, nim, gomoku];

/** Register every built-in game. Call once at platform startup. */
export function registerBuiltInGames(): void {
  for (const game of builtInGames) {
    registerGame(game);
  }
}
