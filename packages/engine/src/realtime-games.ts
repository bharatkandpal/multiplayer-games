// Wiring between concrete real-time modules and the sibling realtime registry
// (parallel to ./games.ts for the turn-based family).

import { registerRealtimeGame } from "./realtime-registry";
import { floppyBirds } from "./floppy-birds";
import { drunkWalk } from "./drunk-walk";
import { reflexTest } from "./reflex-test";
import { game2048 } from "./game2048";
import { breakout } from "./breakout";

/** All real-time modules shipped with the platform. */
export const builtInRealtimeGames = [floppyBirds, drunkWalk, reflexTest, game2048, breakout];

/** Register every built-in real-time game. Call once at platform startup. */
export function registerBuiltInRealtimeGames(): void {
  for (const game of builtInRealtimeGames) {
    registerRealtimeGame(game);
  }
}
