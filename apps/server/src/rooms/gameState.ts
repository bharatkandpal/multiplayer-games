// Server-authoritative move application (MPG-013). Pure w.r.t. transport — no
// Socket.IO here, just Room + engine plumbing, so it's independently testable and
// reusable by a future bot turn-advancement loop (Phase 2 "move AI to server-side
// runner" — see docs/ROADMAP.md, out of scope for this ticket).

import { getGame, IllegalMoveError } from "@mpg/engine";
import type { AnyGameModule, IllegalMoveReason, Result } from "@mpg/engine";

import type { Room, Slot } from "./types.js";

/** The three documented `move:rejected` reasons — see docs/API_SPEC.md §3.2. */
export type MoveRejectReason = "NOT_YOUR_TURN" | "ILLEGAL_MOVE" | "GAME_OVER";

export type MoveOutcome = { ok: true; result: Result } | { ok: false; reason: MoveRejectReason };

/**
 * Validate and apply a move on behalf of `slot` against `room`'s authoritative engine
 * state. `slot` MUST be derived server-side (the socket's bound seat), never taken from
 * client input — that's what makes turn ownership authoritative.
 *
 * On success, mutates `room.state`, `room.turn`, `room.moveLog`, and (on a terminal
 * result) `room.status` in place, and returns the engine's `Result`. On rejection, the
 * room is left untouched.
 */
export function applyPlayerMove(room: Room, slot: Slot, move: unknown): MoveOutcome {
  if (room.status !== "active") {
    return { ok: false, reason: "GAME_OVER" };
  }

  const module: AnyGameModule = getGame(room.gameId);

  let nextState: unknown;
  try {
    nextState = module.applyMove(room.state, move, slot);
  } catch (err) {
    if (err instanceof IllegalMoveError) {
      return { ok: false, reason: toRejectReason(err.reason) };
    }
    throw err;
  }

  room.state = nextState;
  room.moveLog.push({ slot, move, timestamp: Date.now() });

  const result: Result = module.getResult(nextState);
  if (result.status === "in_progress") {
    room.turn = module.currentPlayer(nextState);
  } else {
    room.status = "finished";
  }

  return { ok: true, result };
}

function toRejectReason(reason: IllegalMoveReason): MoveRejectReason {
  switch (reason) {
    case "not_your_turn":
      return "NOT_YOUR_TURN";
    case "game_over":
      return "GAME_OVER";
    case "illegal_move":
    case "out_of_bounds":
      return "ILLEGAL_MOVE";
    default:
      return "ILLEGAL_MOVE";
  }
}
