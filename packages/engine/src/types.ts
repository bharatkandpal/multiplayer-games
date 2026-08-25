// Core, framework-agnostic types for the shared game engine.
// These run identically on the client (optimistic UI) and the server (authoritative).

/**
 * A player identity within a game, as a 1-based turn-order index (player 1, 2, ... N).
 * This maps to a room's seat `slot` on the server. Games are N-player-generic: never
 * assume exactly two players.
 */
export type Player = number;

/**
 * Known games for the POC. This is a closed union today; when games become installable
 * npm plugins (v2 / MPG-031) this widens to an open `string` behind the registry.
 */
export type GameId = "connect4" | "tictactoe";

/** Bot strength. Difficulty is a property of a seat, not a room — rooms may mix levels. */
export type Difficulty = "easy" | "medium" | "hard";

export type GameStatus = "in_progress" | "win" | "draw";

/** The outcome of a position. `winner` is present only on a win. */
export type Result =
  { status: "in_progress" } | { status: "win"; winner: Player } | { status: "draw" };

/**
 * The one interface every game implements. The platform (room manager, transport, AI
 * runner) is written against this and nothing else, so a new game is purely additive.
 *
 * Implementations MUST be pure: no I/O, no clock, no randomness. (Easy-bot randomness
 * lives in the AI layer via an injected RNG, never in the rules.)
 *
 * @typeParam S - the game's state shape (an opaque, serializable value)
 * @typeParam M - the game's move shape
 */
export interface GameModule<S, M> {
  /** Stable identifier used by the registry and the wire protocol. */
  readonly id: GameId;

  /** Number of players/sides this game supports (POC games: 2). N-player-generic. */
  readonly playerCount: number;

  /** A fresh starting position. */
  createInitialState(): S;

  /** All moves legal from `state` for the player whose turn it is. */
  legalMoves(state: S): M[];

  /**
   * Apply `move` made by `player`, returning the next state. Pure — never mutates `state`.
   * Throws {@link IllegalMoveError} if it is not `player`'s turn or `move` is illegal.
   */
  applyMove(state: S, move: M, player: Player): S;

  /** Terminal/ongoing status of `state`. */
  getResult(state: S): Result;

  /** The player whose turn it is in `state`. */
  currentPlayer(state: S): Player;

  /**
   * Heuristic score of `state` from `forPlayer`'s perspective (higher = better for them).
   * Used by minimax at non-terminal depth cutoffs. See docs/GAME_LOGIC.md.
   */
  evaluate(state: S, forPlayer: Player): number;
}
