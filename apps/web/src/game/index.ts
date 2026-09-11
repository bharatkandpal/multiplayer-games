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
  botDifficultyFor,
  createDefaultSeats,
  describeSeat,
  presetSeats,
  sameSeatKinds,
} from "./seatConfig";

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

export { clearPersonalBest, loadPersonalBest, recordPersonalBest } from "./personalBest";
