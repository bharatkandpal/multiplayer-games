// Server-side AI turn-advancement loop (MPG-014) — "move AI to server-side runner".
//
// Bot seats are never sockets (docs/ARCHITECTURE.md): a human's move (or the room
// activating with a bot holding the first turn) can leave the *next* turn belonging to
// a bot seat. This module is the single place that drives those turns, always through
// the same `applyPlayerMove` validation path a human move goes through — there is no
// separate "trusted" code path for bot moves.
//
// Stays transport-agnostic (no Socket.IO here): `moveHandler.ts` wires this to `io` +
// persistence via the `BotRunnerHandlers` callback, keeping the transport swappable.
// The AI itself (`pickMove`) is pure/stateless — this class only owns *scheduling*
// (setTimeout pacing) and re-validates against the live room on every tick, so a room
// that's expired, been abandoned, or otherwise moved on is a safe no-op rather than a
// stale write.

import { getGame, pickMove } from "@mpg/engine";
import type { AnyGameModule, Result } from "@mpg/engine";

import { applyPlayerMove } from "./gameState.js";
import type { RoomManager } from "./RoomManager.js";
import type { Room, Slot } from "./types.js";

/** Callbacks the bot runner invokes on every bot-applied move — mirrors the
 * `game:update` / `game:over` broadcasts a human move triggers. */
export interface BotRunnerHandlers {
  onUpdate(room: Room, lastMove: { slot: Slot; move: unknown }): void;
  onGameOver(room: Room, result: Result): void;
}

export interface BotRunnerOptions {
  /** Randomized "natural" reply delay range for a bot's first move after a human's
   * (or a freshly-active room's first turn), so bot replies don't feel instant. */
  minReplyDelayMs?: number;
  maxReplyDelayMs?: number;
  /** Injectable for deterministic tests; defaults to `Math.random`. */
  rng?: () => number;
}

const DEFAULT_MIN_REPLY_DELAY_MS = 200;
const DEFAULT_MAX_REPLY_DELAY_MS = 400;

/**
 * Drives bot seats' turns for every room, on a per-room `setTimeout` chain.
 *
 * One instance is shared across all rooms (like `RoomManager`); it tracks at most one
 * pending timer per room ID. Handles human-vs-bot (single natural-paced reply),
 * mixed-difficulty bots, and all-bot "watch" rooms (each hop after the first is paced at
 * `room.pacingMs`, default ~600ms, for spectating — see docs/TDD.md §6).
 */
export class BotRunner {
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly roomManager: RoomManager,
    private readonly handlers: BotRunnerHandlers,
    private readonly options: BotRunnerOptions = {},
  ) {}

  /**
   * Ensure the bot turn-advancement loop is (re)started for `room` if it's currently a
   * bot's turn. Idempotent — call after every authoritative state change: a human move
   * landing, or the room transitioning waiting -> active (covers a bot holding the very
   * first turn, including all-bot watch rooms). A no-op if it isn't a bot's turn.
   *
   * @param paced - `true` for the ~600ms watch-mode pacing (continuing a bot-vs-bot
   *   chain); `false` for the shorter randomized "natural" reply delay (a bot replying to
   *   a human, or the very first turn of a newly-active room).
   */
  scheduleNext(room: Room, paced: boolean): void {
    this.cancel(room.id);
    if (room.status !== "active") return;

    const seat = room.seats.find((s) => s.slot === room.turn);
    if (!seat || seat.kind !== "bot") return;

    const delay = paced ? (room.pacingMs ?? 600) : this.replyDelay();
    const timer = setTimeout(() => {
      this.pending.delete(room.id);
      this.playOne(room.id);
    }, delay);
    timer.unref?.();
    this.pending.set(room.id, timer);
  }

  /** Cancel any pending bot move for a room — e.g. it was just abandoned or expired. */
  cancel(roomId: string): void {
    const timer = this.pending.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.pending.delete(roomId);
    }
  }

  /** Stop every pending timer (server shutdown / test teardown). */
  destroy(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  private replyDelay(): number {
    const min = this.options.minReplyDelayMs ?? DEFAULT_MIN_REPLY_DELAY_MS;
    const max = this.options.maxReplyDelayMs ?? DEFAULT_MAX_REPLY_DELAY_MS;
    const rng = this.options.rng ?? Math.random;
    return Math.round(min + rng() * Math.max(0, max - min));
  }

  private playOne(roomId: string): void {
    // Re-fetch rather than closing over the `Room` passed to `scheduleNext`: the room
    // may have expired, been abandoned, or already moved on by the time this timer
    // fires, and `RoomManager.getRoom` is what expires/evicts on TTL lookup.
    const room = this.roomManager.getRoom(roomId);
    if (!room || room.status !== "active") return;

    const seat = room.seats.find((s) => s.slot === room.turn);
    if (!seat || seat.kind !== "bot") return;

    const module: AnyGameModule = getGame(room.gameId);
    const move = pickMove(module, room.state, seat.difficulty ?? "medium");

    // Same authoritative path a human move goes through — no separate "trusted" write.
    const outcome = applyPlayerMove(room, seat.slot, move);
    if (!outcome.ok) {
      // `pickMove` only returns legal moves for the state it was given, so a rejection
      // here means a bug, not a normal race. Stop rather than spin.
      console.error(
        `BotRunner: bot move rejected in room ${roomId} (slot ${seat.slot}): ${outcome.reason}`,
      );
      return;
    }

    this.handlers.onUpdate(room, { slot: seat.slot, move });

    if (outcome.result.status !== "in_progress") {
      this.handlers.onGameOver(room, outcome.result);
      return;
    }

    // Keep the loop going if the next turn is also a bot (mixed-bot / all-bot watch
    // mode), now paced for spectating regardless of what paced this hop.
    this.scheduleNext(room, true);
  }
}
