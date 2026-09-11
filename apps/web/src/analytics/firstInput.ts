/**
 * Time-to-first-input (MPG-097, leg 5).
 *
 * The one funnel measurement the server genuinely cannot make. It sees a share
 * link resolve; it has no idea whether the person who opened it ever actually
 * played, or how long they stared at the page first. That gap is the whole
 * question leg 5 asks — a link that converts to a *view* is worth very little
 * if it never converts to a *move*.
 *
 * Two rules:
 *
 *  1. **Once per page load.** A session is timed from arrival to its first
 *     input, not per game. Firing again on the second move would turn a latency
 *     metric into a move counter.
 *  2. **Cold arrivals are marked, not assumed.** `markColdArrival` is called
 *     only when the page was actually entered through `/s/:token`, so
 *     `viaShare` distinguishes "a stranger followed a link" from "the owner
 *     reopened the tab they already had". Only the former counts toward
 *     anything viral.
 */

import { track } from "../api/events.js";

interface ArrivalState {
  readonly at: number;
  readonly viaShare: boolean;
}

let arrival: ArrivalState = { at: Date.now(), viaShare: false };
let fired = false;

/** Record that this page load came in through a share link. */
export function markColdArrival(): void {
  arrival = { at: Date.now(), viaShare: true };
  fired = false;
}

/**
 * Report the first real input of this page load. Safe to call on every move —
 * every call after the first is a no-op.
 *
 * "Real input" means a move the player chose, not a render or a bot's turn.
 * Callers are responsible for that distinction; this only enforces once-ness.
 */
export function markFirstInput(gameId?: string): void {
  if (fired) return;
  fired = true;

  track("first_input", {
    ...(gameId ? { gameId } : {}),
    props: {
      msSinceArrival: Math.max(0, Date.now() - arrival.at),
      viaShare: arrival.viaShare,
    },
  });
}

/** Test seam — restores the module to its just-loaded state. */
export function __resetFirstInput(): void {
  arrival = { at: Date.now(), viaShare: false };
  fired = false;
}
