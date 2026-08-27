// @mpg/engine — pure, shared game engine (rules + minimax).
// Public surface. Concrete games (connect4, tictactoe) self-register via
// registerGame(); the generic minimax AI lands in MPG-007.

export const ENGINE_VERSION = "0.0.0";

export type {
  Player,
  GameId,
  Difficulty,
  GameStatus,
  Result,
  GameModule,
  DrawReason,
} from "./types";

export { IllegalMoveError } from "./errors";
export type { IllegalMoveReason } from "./errors";

export { registerGame, getGame, hasGame, listGames, clearRegistry } from "./registry";
export type { AnyGameModule } from "./registry";

// Real-time arcade game family (ADR 0002) — a sibling of the turn-based surface
// above, with its own module interface, id union, and registry.
export type { RealtimeModule, RealtimeGameId } from "./realtime";
export {
  registerRealtimeGame,
  getRealtimeGame,
  hasRealtimeGame,
  listRealtimeGames,
  clearRealtimeRegistry,
} from "./realtime-registry";
export type { AnyRealtimeModule } from "./realtime-registry";

export { seedPrng, nextFloat } from "./prng";
export type { PrngState } from "./prng";

export { floppyBirds, WORLD as FLOPPY_WORLD } from "./floppy-birds";
export type { FloppyState, FloppyInput, Pipe } from "./floppy-birds";

export { builtInRealtimeGames, registerBuiltInRealtimeGames } from "./realtime-games";

export { ticTacToe } from "./tictactoe";
export type { TicTacToeState, TicTacToeMove, TicTacToeLine, Cell } from "./tictactoe";

export { ticTacToeMove } from "./tictactoe-move";
export type { TicTacToeMoveState, TicTacToeMoveMove, TicTacToeMoveLine } from "./tictactoe-move";

export { connectFour } from "./connect4";
export type {
  ConnectFourState,
  ConnectFourMove,
  ConnectFourCoord,
  ConnectFourLine,
} from "./connect4";

export { builtInGames, registerBuiltInGames } from "./games";

export { minimax, searchBestMove } from "./ai/minimax";
export type { SearchOptions, SearchResult } from "./ai/minimax";

export {
  pickMove,
  getDifficultyConfig,
  DIFFICULTY_TABLE,
  DEFAULT_DIFFICULTY,
} from "./ai/difficulty";
export type { Rng, DifficultyConfig } from "./ai/difficulty";
