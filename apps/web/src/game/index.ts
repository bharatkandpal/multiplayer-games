export type {
  AppliedMove,
  GameSessionAction,
  GameSessionState,
  GameSessionStatus,
} from "./gameSession";
export { createGameSession, gameSessionReducer } from "./gameSession";

export type { UseGameSessionResult } from "./useGameSession";
export { useGameSession } from "./useGameSession";

export { describeIllegalMoveError, describeIllegalMoveReason } from "./errorMessages";

export type {
  BotSeatConfig,
  HumanSeatConfig,
  OpponentPreset,
  SeatConfig,
  SeatsConfig,
} from "./seatConfig";
export {
  DEFAULT_BOT_DIFFICULTY,
  assignBotNames,
  botDifficultyFor,
  createDefaultSeats,
  describeSeat,
  presetSeats,
  sameSeatKinds,
} from "./seatConfig";
export { BOT_NAMES, FEMALE_BOT_NAMES, MALE_BOT_NAMES, pickBotName } from "./botNames";

export { getBotThinkingDelayMs } from "./motion";

export type { LocalPlayController, WatchSpeed } from "./useLocalPlayController";
export { useLocalPlayController } from "./useLocalPlayController";

export type {
  RealtimeLoopPhase,
  RunComplete,
  UseRealtimeLoopParams,
  UseRealtimeLoopResult,
} from "./useRealtimeLoop";
export { useRealtimeLoop } from "./useRealtimeLoop";

export type {
  InputBinding,
  InputSource,
  InputSourceHost,
  InputSourceId,
  InputSourceStatus,
  RealtimeControls,
  TouchAction,
} from "./inputSource";
export { createActionInputSource } from "./inputSource";

export type { PointerAxisConfig } from "./pointerAxisInputSource";
export { createPointerAxisInputSource } from "./pointerAxisInputSource";

export type { TapTargetConfig } from "./tapTargetInputSource";
export { createTapTargetInputSource } from "./tapTargetInputSource";

export { clearPersonalBest, loadPersonalBest, recordPersonalBest } from "./personalBest";
