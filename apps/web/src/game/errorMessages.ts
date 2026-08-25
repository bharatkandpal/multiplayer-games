// Plain-language copy for engine-level move rejections. Shared by:
//   - the local optimistic-move path (MPG-030, this file's first consumer)
//   - the future socket layer's `move:rejected` handler (Phase 2), which carries
//     the same `IllegalMoveReason` values over the wire (see docs/API_SPEC.md)
// Keeping this mapping in one place means the copy never drifts between the two.

import type { IllegalMoveError, IllegalMoveReason } from "@mpg/engine";

const ILLEGAL_MOVE_MESSAGES: Record<IllegalMoveReason, string> = {
  not_your_turn: "Hold on — it's not your turn yet.",
  illegal_move: "That move isn't allowed there. Try a different spot.",
  game_over: "The game's already over — start a rematch to keep playing.",
  out_of_bounds: "That's outside the board. Try a different spot.",
};

const FALLBACK_MESSAGE = "That move couldn't be made. Give it another try.";

/** Friendly copy for a known {@link IllegalMoveReason}. Never a raw error code. */
export function describeIllegalMoveReason(reason: IllegalMoveReason): string {
  return ILLEGAL_MOVE_MESSAGES[reason] ?? FALLBACK_MESSAGE;
}

/** Friendly copy for a thrown {@link IllegalMoveError} (local engine or server rejection). */
export function describeIllegalMoveError(error: IllegalMoveError): string {
  return describeIllegalMoveReason(error.reason);
}
