/** Why a proposed move was rejected by the engine. */
export type IllegalMoveReason = "not_your_turn" | "illegal_move" | "game_over" | "out_of_bounds";

/**
 * Thrown by `GameModule.applyMove` when a move cannot be applied. The server maps this to
 * a `move:rejected` event (see docs/API_SPEC.md); the client reverts the optimistic move.
 */
export class IllegalMoveError extends Error {
  readonly reason: IllegalMoveReason;

  constructor(reason: IllegalMoveReason, message?: string) {
    super(message ?? reason);
    this.name = "IllegalMoveError";
    this.reason = reason;
  }
}
