// @mpg/engine — pure, shared game engine (rules + minimax).
// Public surface. Concrete games (connect4, tictactoe) land in MPG-005 / MPG-006 and
// self-register via registerGame(); the generic minimax AI lands in MPG-007.

export const ENGINE_VERSION = "0.0.0";

export type { Player, GameId, Difficulty, GameStatus, Result, GameModule } from "./types";

export { IllegalMoveError } from "./errors";
export type { IllegalMoveReason } from "./errors";

export { registerGame, getGame, hasGame, listGames, clearRegistry } from "./registry";
export type { AnyGameModule } from "./registry";

export { ticTacToe } from "./tictactoe";
export type { TicTacToeState, TicTacToeMove, Cell } from "./tictactoe";

export { builtInGames, registerBuiltInGames } from "./games";
