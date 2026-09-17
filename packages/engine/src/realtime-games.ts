// Wiring between concrete real-time modules and the sibling realtime registry
// (parallel to ./games.ts for the turn-based family).

import { registerRealtimeGame } from "./realtime-registry";
import { floppyBirds } from "./floppy-birds";
import { drunkWalk } from "./drunk-walk";
import { reflexTest } from "./reflex-test";
import { game2048, game2048_3, game2048_5 } from "./game2048";
import { breakout } from "./breakout";
import { snake } from "./snake";
import { lumberjack } from "./lumberjack";
import { memorySequence } from "./memory-sequence";
import { aimTrainer } from "./aim-trainer";

/**
 * All real-time modules shipped with the platform. The 2048 grid-size variants
 * (`2048@3` / `2048@5`) register as their own modules so both the web registry
 * and the server's re-simulation resolve the right board dimension by id.
 */
export const builtInRealtimeGames = [
  floppyBirds,
  drunkWalk,
  reflexTest,
  game2048,
  game2048_3,
  game2048_5,
  breakout,
  snake,
  lumberjack,
  memorySequence,
  aimTrainer,
];

/** Register every built-in real-time game. Call once at platform startup. */
export function registerBuiltInRealtimeGames(): void {
  for (const game of builtInRealtimeGames) {
    registerRealtimeGame(game);
  }
}
