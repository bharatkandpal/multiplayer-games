// Wiring between concrete real-time modules and the sibling realtime registry
// (parallel to ./games.ts for the turn-based family).

import { registerRealtimeGame } from "./realtime-registry";
import { floppyBirds } from "./floppy-birds";
import { drunkWalk } from "./drunk-walk";

/** All real-time modules shipped with the platform. */
export const builtInRealtimeGames = [floppyBirds, drunkWalk];

/** Register every built-in real-time game. Call once at platform startup. */
export function registerBuiltInRealtimeGames(): void {
  for (const game of builtInRealtimeGames) {
    registerRealtimeGame(game);
  }
}
