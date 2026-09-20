// Per-game wiring between the generic `RealtimePlayScreen`/`useRealtimeLoop`
// and each concrete `RealtimeModule` + its renderer — the real-time sibling of
// `screens/games.tsx` (ADR 0002 §2: "a small map from realtime id →
// { module, renderer }"). Kept small and mechanical: all orchestration lives in
// the shared, engine- and renderer-agnostic `RealtimePlayScreen`.

import { useMemo, useState, type ReactNode } from "react";
import {
  aimTrainer,
  AIM,
  breakout,
  drunkWalk,
  floppyBirds,
  game2048,
  game2048_3,
  game2048_5,
  lumberjack,
  memorySequence,
  reflexTest,
  snake,
  type AimTrainerInput,
  type AimTrainerState,
  type BreakoutInput,
  type BreakoutState,
  type DrunkWalkInput,
  type DrunkWalkState,
  type FloppyInput,
  type FloppyState,
  type LumberjackInput,
  type LumberjackState,
  type MemorySequenceInput,
  type MemorySequenceState,
  type PadIndex,
  type Game2048Input,
  type Game2048Size,
  type Game2048State,
  type RealtimeGameId,
  type RealtimeModule,
  type ReflexInput,
  type ReflexState,
  type SnakeDir,
  type SnakeInput,
  type SnakeState,
  type SwipeDir,
} from "@mpg/engine";
import { DrunkWalkScene } from "../components/realtime/DrunkWalkScene";
import { DrunkWalkCustomizeMenu } from "../components/realtime/DrunkWalkCustomizeMenu";
import {
  DEFAULT_DRUNK_WALK_CHARACTER,
  loadStoredDrunkWalkCharacter,
  storeDrunkWalkCharacter,
  type DrunkWalkCharacter,
} from "../components/realtime/drunkWalkCharacter";
import { FloppyBirdsScene } from "../components/realtime/FloppyBirdsScene";
import { ReflexTestScene } from "../components/realtime/ReflexTestScene";
import { Game2048Scene } from "../components/realtime/Game2048Scene";
import { Game2048CustomizeMenu } from "../components/realtime/Game2048CustomizeMenu";
import { loadStored2048Size, store2048Size } from "../components/realtime/game2048Size";
import { BreakoutScene } from "../components/realtime/BreakoutScene";
import { SnakeScene } from "../components/realtime/SnakeScene";
import { LumberjackScene } from "../components/realtime/LumberjackScene";
import { MemorySequenceScene } from "../components/realtime/MemorySequenceScene";
import { AimTrainerScene } from "../components/realtime/AimTrainerScene";
import { Button, GearIcon } from "../components/ui";
import type { GameNavigation } from "../components/ui";
import {
  RealtimePlayScreen,
  type RealtimeControls,
  type RealtimeSceneProps,
} from "./RealtimePlayScreen";
import { REALTIME_CATALOG } from "./HomeScreen";
import { RankPreview } from "./RankPreview";
import { submitRealtimeScore } from "../api/leaderboard";
import { noteValueMoment } from "../api/identity";
import { mintResultShareUrl } from "../api/share";
import {
  createActionInputSource,
  createPointerAxisInputSource,
  createTapTargetInputSource,
  type InputSource,
} from "../game";
import type { RunComplete } from "../game/useRealtimeLoop";
import { recordPersonalBest } from "../game/personalBest";

/**
 * One row of real-time wiring — the behavioral half (module + renderer +
 * controls). Presentational metadata (title) lives in `REALTIME_CATALOG`
 * alongside the turn-based `GAME_CATALOG`, so the route reads its title the same
 * way the turn-based routes do. `S`/`I` are erased at the map boundary (a
 * heterogeneous record can't keep each game's concrete generics) — the factory
 * below re-ties them per entry so every registration stays type-checked.
 */
export interface RealtimeGameWiring {
  readonly module: RealtimeModule<unknown, unknown>;
  readonly renderScene: (props: RealtimeSceneProps<unknown>) => ReactNode;
  /**
   * Builds this game's input source (MPG-120). A fresh source per call — it owns
   * mutable input state, so the route memoises one per mount. Most games use the
   * discrete-action source; axis games (e.g. Breakout) use `pointer-axis`.
   */
  readonly makeInputSource: () => InputSource<unknown>;
  /**
   * The discrete-action config, present only for games that use the action
   * source. Kept on the wiring for introspection/tests; axis games omit it.
   */
  readonly controls?: RealtimeControls<unknown>;
}

/** An action (keys/taps/buttons) game — wraps its `controls` in the action source. */
function defineRealtimeGame<S, I, A extends string>(
  module: RealtimeModule<S, I>,
  renderScene: (props: RealtimeSceneProps<S>) => ReactNode,
  controls: RealtimeControls<I, A>,
): RealtimeGameWiring {
  return {
    module,
    renderScene,
    controls,
    makeInputSource: () => createActionInputSource(controls),
  } as unknown as RealtimeGameWiring;
}

/**
 * A game that supplies its own `InputSource` factory rather than a set of discrete
 * actions — the pointer-axis games (Breakout) and the tap-target ones (Aim
 * Trainer). Named for the axis case because that was the only one when it landed;
 * the shape it actually captures is "brings its own source".
 */
function defineRealtimeAxisGame<S, I>(
  module: RealtimeModule<S, I>,
  renderScene: (props: RealtimeSceneProps<S>) => ReactNode,
  makeInputSource: () => InputSource<I>,
): RealtimeGameWiring {
  return { module, renderScene, makeInputSource } as unknown as RealtimeGameWiring;
}

const floppyControls: RealtimeControls<FloppyInput, "flap"> = {
  primaryAction: "flap",
  keyMap: { Space: "flap", ArrowUp: "flap" },
  toInput: (pressed) => ({ flap: pressed.has("flap") }),
  actionHint: "Tap, Space, or ↑ to flap",
};

// Drunk Walk's input isn't a single boolean flap — it's "which half of the
// screen" (left/right). `primaryAction` still needs a value (used only as the
// keyboard-parity fallback and README-style default), but `resolveTapAction`
// is what actually drives plain taps: it splits the play surface at its
// horizontal midpoint, matching the two on-screen "L"/"R" zones the renderer
// draws (see DrunkWalkScene). ← / → and A / D give keyboard parity per side.
const drunkWalkControls: RealtimeControls<DrunkWalkInput, "left" | "right"> = {
  primaryAction: "left",
  keyMap: {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
  },
  toInput: (pressed) => {
    if (pressed.has("left")) return { tap: "left" };
    if (pressed.has("right")) return { tap: "right" };
    return { tap: null };
  },
  actionHint: "Tap left/right (or ←/→, A/D) to balance",
  readyExplainer:
    "You lean under gravity. Tap the side OPPOSITE your lean to correct it — tapping the same side speeds up the fall.",
  resolveTapAction: (fractionX) => (fractionX < 0.5 ? "left" : "right"),
};

// Any tap is the same "I saw it" signal, so every key maps to one action and the
// whole surface is the target — no `resolveTapAction`, no on-screen buttons. The
// explainer spells out the false-start rule up front: a player who only discovers
// it by losing a run has been punished by a rule nobody told them.
const reflexControls: RealtimeControls<ReflexInput, "tap"> = {
  primaryAction: "tap",
  keyMap: { Space: "tap", Enter: "tap", ArrowUp: "tap", ArrowDown: "tap" },
  toInput: (pressed) => ({ tap: pressed.has("tap") }),
  actionHint: "Tap (or press Space) the moment the panel turns green",
  readyExplainer:
    "The panel holds red for a random moment, then turns green — tap as fast as you can. Five rounds. Tap while it's still red and the run ends immediately.",
};

// 2048 has four discrete swipe actions. A real finger swipe on the board
// resolves from the drag vector (`resolveSwipeAction`, dominant axis wins —
// the classic 2048 gesture); on-screen buttons (a D-pad) are the unambiguous
// fallback for a player who prefers taps; arrows and WASD give keyboard
// parity. A drag too short to count as a swipe (or, on desktop, a plain
// click) falls back to `primaryAction` — harmless on a puzzle where a stray
// swipe that changes nothing is simply a no-op. When more than one direction
// is in the pressed set for a tick (rare — two keys held at once), a fixed
// priority order picks one so the input stays a single well-defined swipe.
const SWIPE_PRIORITY: readonly SwipeDir[] = ["up", "down", "left", "right"];
const game2048Controls: RealtimeControls<Game2048Input, SwipeDir> = {
  primaryAction: "up",
  keyMap: {
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
  },
  toInput: (pressed) => {
    const swipe = SWIPE_PRIORITY.find((dir) => pressed.has(dir)) ?? null;
    return { swipe };
  },
  actionHint: "Swipe the board, or use the arrows, WASD, or the buttons",
  readyExplainer:
    "Slide the tiles in one direction — equal tiles merge and add up. A new tile appears after every move. You lose when the board fills up with no moves left.",
  resolveSwipeAction: (dx, dy) => {
    // Dominant axis wins — a mostly-horizontal drag is left/right even if it
    // wobbles a little vertically, and vice versa (matches every other 2048).
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  },
  touchActions: [
    { action: "up", label: "↑" },
    { action: "left", label: "←" },
    { action: "right", label: "→" },
    { action: "down", label: "↓" },
  ],
};

// Memory Sequence's four pads ARE the four actions — and, laid out 2×2, they are
// literally the four quadrants of the play surface. So a tap is resolved by WHERE
// it lands (`resolveTapAction`) rather than always meaning "pad 0", and there are
// no on-screen buttons: the board itself is the control, exactly as the pads you
// watch flash are the pads you press back. The quadrant order matches the scene's
// layout (col = i % 2, row = ⌊i / 2⌋): pad0 top-left, pad1 top-right, pad2
// bottom-left, pad3 bottom-right. 1-4 and the arrow keys keep a keyboard path.
type MemoryPadAction = "pad0" | "pad1" | "pad2" | "pad3";
const MEMORY_PADS: readonly MemoryPadAction[] = ["pad0", "pad1", "pad2", "pad3"];
const memoryControls: RealtimeControls<MemorySequenceInput, MemoryPadAction> = {
  primaryAction: "pad0",
  keyMap: {
    Digit1: "pad0",
    Digit2: "pad1",
    Digit3: "pad2",
    Digit4: "pad3",
    ArrowUp: "pad0",
    ArrowRight: "pad1",
    ArrowLeft: "pad2",
    ArrowDown: "pad3",
  },
  toInput: (pressed) => {
    const hit = MEMORY_PADS.findIndex((action) => pressed.has(action));
    return { pad: hit === -1 ? null : (hit as PadIndex) };
  },
  // Which quadrant the tap fell in → that pad. The 0.5/0.5 split mirrors the
  // scene's 2×2 grid and is robust to any letterboxing (the canvas stays
  // centred), the same assumption the left/right tap games already rely on.
  resolveTapAction: (fractionX, fractionY): MemoryPadAction => {
    const col = fractionX < 0.5 ? 0 : 1;
    const row = fractionY < 0.5 ? 0 : 1;
    return MEMORY_PADS[row * 2 + col] ?? "pad0";
  },
  actionHint: "Tap the pads on the board (or press 1-4) to repeat the sequence",
  readyExplainer:
    "Watch the pads flash, then tap them back in the same order. Each round adds one more. A wrong pad ends the run — and so does taking too long on your turn.",
};

// Lumberjack's chop is a single committed action per side — the same left/right
// tap-zone vocabulary Drunk Walk uses, and for the same reason: the two halves of
// the surface ARE the two choices, so splitting at the midpoint needs no on-screen
// buttons to be legible. The explainer names the timer, because a player who only
// discovers the clock by losing to it has been beaten by a rule nobody told them.
const lumberjackControls: RealtimeControls<LumberjackInput, "left" | "right"> = {
  primaryAction: "left",
  keyMap: {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
  },
  toInput: (pressed) => {
    if (pressed.has("left")) return { chop: "left" };
    if (pressed.has("right")) return { chop: "right" };
    return { chop: null };
  },
  actionHint: "Tap left/right (or ←/→, A/D) to chop from that side",
  readyExplainer:
    "Chop from the side with no branch at your height — and watch the log about to drop onto you. The timer drains the whole time and every chop tops it up, so stopping to think is its own way to lose.",
  resolveTapAction: (fractionX) => (fractionX < 0.5 ? "left" : "right"),
};

// Snake steers rather than swipes, but the INPUT shape is 2048's: four discrete
// directions from a drag, a D-pad, arrows or WASD. Deliberately its own controls
// object rather than a shared one — the two games agree on gesture vocabulary
// today and have no reason to stay agreed (2048's swipe applies to a settled
// board; Snake's turn is queued for the next cell boundary), and the copy below
// is each game's own words either way.
const SNAKE_PRIORITY: readonly SnakeDir[] = ["up", "down", "left", "right"];
const snakeControls: RealtimeControls<SnakeInput, SnakeDir> = {
  primaryAction: "up",
  keyMap: {
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
  },
  toInput: (pressed) => ({ turn: SNAKE_PRIORITY.find((dir) => pressed.has(dir)) ?? null }),
  actionHint: "Swipe, or use the arrows, WASD, or the buttons, to turn",
  readyExplainer:
    "The snake never stops — you only steer. Eat the food to grow and score. Hitting a wall or your own tail ends the run, and you can't turn back on yourself.",
  resolveSwipeAction: (dx, dy) =>
    Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up",
  touchActions: [
    { action: "up", label: "↑" },
    { action: "left", label: "←" },
    { action: "right", label: "→" },
    { action: "down", label: "↓" },
  ],
};

// Breakout is POSITION-controlled (MPG-121): the paddle tracks the pointer
// directly — mouse hover or touch drag — with arrow/A-D keyboard parity. This
// fixed the lag of the old left/right nudge. The pointer x-fraction becomes the
// paddle's target; the engine's convex face does the reflection steering.
const BREAKOUT_KEY_STEP = 0.02; // ~0.8s to traverse the field on the keyboard
function makeBreakoutInputSource(): InputSource<BreakoutInput> {
  return createPointerAxisInputSource<BreakoutInput>({
    toInput: (axis) => ({ targetX: axis }),
    axis: "x",
    keyStepPerTick: BREAKOUT_KEY_STEP,
    hint: "Move the mouse or drag to steer the paddle (or ←/→, A/D)",
    readyExplainer:
      "Bounce the ball into the bricks to clear them. The paddle's curved face steers the ball — hit near an edge to angle it, dead centre to send it straight up. Miss and you lose a life; you have three.",
    label: "Mouse & keys",
  });
}

// Aim Trainer is POSITION-tapped (MPG-142): where you tap IS the input, so it
// uses the new `tap-target` source rather than a fixed set of actions. The grid
// handed to the source is only for the keyboard cursor — pointer taps are
// continuous, and the engine's `cellAt` is the single authority on which cell a
// position belongs to.
function makeAimTrainerInputSource(): InputSource<AimTrainerInput> {
  return createTapTargetInputSource<AimTrainerInput>({
    toInput: (tap) => ({ tap }),
    cols: AIM.cols,
    rows: AIM.rows,
    hint: "Tap the targets (or move with ←→↑↓ and hit Space)",
    readyExplainer:
      "Targets appear and fade. Tap one before its ring runs out. A target you let expire costs a miss — and so does a tap that hits nothing, so don't spray the board. Five misses ends the run.",
    label: "Tap & keys",
  });
}

/**
 * The real-time catalog. `Partial` like the turn-based `GAME_CATALOG`:
 * `RealtimeGameId` already includes `"lumberjack"` (MPG-041), which isn't built
 * yet, so only registered games appear.
 */
export const REALTIME_GAMES: Partial<Record<RealtimeGameId, RealtimeGameWiring>> = {
  "floppy-birds": defineRealtimeGame<FloppyState, FloppyInput, "flap">(
    floppyBirds,
    (props) => <FloppyBirdsScene {...props} />,
    floppyControls,
  ),
  "drunk-walk": defineRealtimeGame<DrunkWalkState, DrunkWalkInput, "left" | "right">(
    drunkWalk,
    (props) => <DrunkWalkScene {...props} />,
    drunkWalkControls,
  ),
  "reflex-test": defineRealtimeGame<ReflexState, ReflexInput, "tap">(
    reflexTest,
    (props) => <ReflexTestScene {...props} />,
    reflexControls,
  ),
  "2048": defineRealtimeGame<Game2048State, Game2048Input, SwipeDir>(
    game2048,
    (props) => <Game2048Scene {...props} />,
    game2048Controls,
  ),
  "memory-sequence": defineRealtimeGame<MemorySequenceState, MemorySequenceInput, MemoryPadAction>(
    memorySequence,
    (props) => <MemorySequenceScene {...props} />,
    memoryControls,
  ),
  lumberjack: defineRealtimeGame<LumberjackState, LumberjackInput, "left" | "right">(
    lumberjack,
    (props) => <LumberjackScene {...props} />,
    lumberjackControls,
  ),
  snake: defineRealtimeGame<SnakeState, SnakeInput, SnakeDir>(
    snake,
    (props) => <SnakeScene {...props} />,
    snakeControls,
  ),
  "aim-trainer": defineRealtimeAxisGame<AimTrainerState, AimTrainerInput>(
    aimTrainer,
    (props) => <AimTrainerScene {...props} />,
    makeAimTrainerInputSource,
  ),
  breakout: defineRealtimeAxisGame<BreakoutState, BreakoutInput>(
    breakout,
    (props) => <BreakoutScene {...props} />,
    makeBreakoutInputSource,
  ),
};

/** A fresh pseudo-random seed for a run — 16 bits is plenty for the PRNG. */
function makeSeed(): number {
  return Date.now() & 0xffff || 1;
}

/**
 * Where a share falls back to when there is no durable result link (MPG-087):
 * the game's own URL, with the score riding along as `?challenge=<score>`.
 *
 * The durable per-result link (MPG-056) is still what a finished run shares
 * whenever one could be minted — that link unfurls a card and carries the score
 * server-side. But when it can't be minted (backend down, offline), the score
 * must still travel, or the recipient just opens the game with nothing to beat.
 * So it rides in the URL instead, and the router parses it straight back into a
 * "Beat this score" target — no backend involved, honouring the offline pillar.
 *
 * The score is omitted only when there genuinely isn't one (a non-finite value),
 * in which case this degrades to the bare game link it used to be.
 */
function buildShareUrl(gameId: RealtimeGameId, score?: number): string {
  const query = typeof score === "number" && Number.isFinite(score) ? `?challenge=${score}` : "";
  const path = `/${gameId}${query}`;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

/**
 * A client-generated id for one finished run. The submit route no-ops on a
 * `runId` it has already persisted, so retrying a failed submission with the
 * SAME id can never double-write — which is why the id is minted per run here
 * rather than server-side.
 */
function makeRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Sends a finished run to the leaderboard for server-side re-simulation
 * (MPG-093). Deliberately fire-and-forget: the server is the authority on the
 * score, so there is nothing for the player to act on here, and a leaderboard
 * write must never block, delay, or interrupt the game-over surface. Failures
 * (offline, 4xx, a 422 `SCORE_MISMATCH`) are logged for debugging and otherwise
 * swallowed. Rank is never assumed optimistically here — the returned promise
 * only tells the caller WHEN the server's view is settled, so the post-game rank
 * preview can read it (see `useSettledRun`) instead of racing the write.
 */
function submitRun(result: RunComplete<unknown>): Promise<string | undefined> {
  return submitRealtimeScore(result.gameId, {
    runId: makeRunId(),
    seed: result.seed,
    score: result.score,
    inputLog: result.inputLog,
  })
    .then((res) => res.resultId)
    .catch((error: unknown) => {
      console.warn("[leaderboard] score submission failed", error);
      return undefined;
    });
}

export interface RealtimeGameRouteProps {
  gameId: RealtimeGameId;
  onExit: () => void;
  /**
   * Opens the full leaderboard for this game (MPG-055). Omit to hide the
   * post-game rank preview entirely — a rank with nowhere to go is a dead end.
   */
  onViewLeaderboard?: () => void;
  /**
   * A score to beat (MPG-087) — set when the player arrived from a friend's
   * shared result via "Beat this score". Forwarded to `RealtimePlayScreen` as
   * its `challengeTarget`. Omit for an ordinary solo run.
   */
  challenge?: { score: number };
  /**
   * MPG-136: neighbouring games for the pinned action bar, forwarded straight
   * to `RealtimePlayScreen`. Omit and the bar has no prev/next to offer.
   */
  navigation?: GameNavigation;
}

/**
 * Post-game rank preview for a real-time run, mounted only once the run's score
 * submission has SETTLED. The submission is what creates/updates the entry the
 * rank is read from, so fetching earlier would race it and show the player their
 * previous rank. A failed submission still settles (fire-and-forget by design) —
 * the preview then just reflects the server's existing view, which is honest.
 */
function useSettledRun(): {
  runKey: number;
  settled: boolean;
  shareToken: string | undefined;
  lastScore: number | undefined;
  onRunComplete: (r: RunComplete<unknown>) => void;
} {
  // `runKey` is bumped per run so the preview remounts (and refetches) on every
  // game over, not just the first; `settled` hides it while a submission is in
  // flight, so the player never sees the PREVIOUS run's rank under this one's score.
  const [{ runKey, settled }, setRun] = useState({ runKey: 0, settled: false });
  // The durable `/s/:token` URL for the run just finished. Cleared at the start
  // of each run so one run's link can never be shared under the next run's score.
  const [shareToken, setShareToken] = useState<string | undefined>(undefined);
  // The score of the run just finished — folded into the fallback share URL so
  // that even without a durable link the shared score still travels (see
  // `buildShareUrl`). Kept from `onRunComplete` rather than read out of the play
  // surface so it's the same authoritative number that gets submitted.
  const [lastScore, setLastScore] = useState<number | undefined>(undefined);

  const onRunComplete = (result: RunComplete<unknown>): void => {
    // Local first, and synchronously: the Home personal-best chip must reflect
    // the run the player just finished even if the score submission never
    // reaches the server. This write touches no network and cannot throw.
    recordPersonalBest(result.gameId, result.score);
    setLastScore(result.score);
    setRun((prev) => ({ ...prev, settled: false }));
    setShareToken(undefined);
    void submitRun(result).then(async (resultId) => {
      // The rank is readable the moment the score write lands; don't make it
      // wait on the share link, which is a separate, optional round-trip.
      setRun((prev) => ({ runKey: prev.runKey + 1, settled: true }));
      if (resultId) {
        // A score the server actually persisted is a "worth keeping" moment
        // (MPG-091-c): nudge the claim prompt. Fire-and-forget; the gate itself
        // decides whether to offer anything (unclaimed + backend reachable).
        noteValueMoment();
        setShareToken(await mintResultShareUrl(resultId));
      }
    });
  };

  return { runKey, settled, shareToken, lastScore, onRunComplete };
}

/**
 * Resolves a real-time game id to its wiring and renders the shared
 * `RealtimePlayScreen`. The App router (MPG-040f) will send `kind: "realtime"`
 * catalog entries straight here (no `SetupScreen` — nothing to configure for a
 * solo run). The initial seed is fixed per mount so a given run is reproducible.
 */
export function RealtimeGameRoute({
  gameId,
  onExit,
  onViewLeaderboard,
  challenge,
  navigation,
}: RealtimeGameRouteProps): React.JSX.Element | null {
  const [seed] = useState(makeSeed);
  // `exactOptionalPropertyTypes` forbids passing `challengeTarget={undefined}`
  // to an optional prop, so spread it in only when there is a target.
  const challengeProps = challenge ? { challengeTarget: challenge.score } : {};
  // Same reason as `challengeProps`: an optional prop can't be passed as
  // `undefined` under `exactOptionalPropertyTypes`.
  const navProps = navigation ? { navigation } : {};
  const { runKey, settled, shareToken, lastScore, onRunComplete } = useSettledRun();
  // Only meaningful for "drunk-walk" (the one game with a character to
  // customize), but declared unconditionally so this component's hook
  // count/order stays stable across `gameId` values.
  const [character, setCharacter] = useState<DrunkWalkCharacter>(() =>
    gameId === "drunk-walk" ? loadStoredDrunkWalkCharacter() : DEFAULT_DRUNK_WALK_CHARACTER,
  );
  // Only meaningful for "2048" (its grid size is customizable), declared
  // unconditionally to keep hook order stable, like `character` above.
  const [size, setSize] = useState<Game2048Size>(() =>
    gameId === "2048" ? loadStored2048Size() : 4,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const wiring = REALTIME_GAMES[gameId];
  // This game's input source (MPG-120). Built once per game: a source owns mutable
  // input state (the action source's pressed set, the pointer source's axis ref),
  // so it must be stable across the screen's re-renders. `wiring` is a stable
  // module-level reference, so the memo recomputes only when the game changes.
  const inputSource = useMemo(() => (wiring ? wiring.makeInputSource() : null), [wiring]);
  if (!wiring || !inputSource) return null;

  const title = REALTIME_CATALOG[gameId]?.title ?? gameId;

  // Real-time games rank on `score`, not the turn-based win/loss/draw metric.
  const rankPreview =
    onViewLeaderboard && settled ? (
      <RankPreview
        key={runKey}
        gameId={gameId}
        metric="score"
        onViewLeaderboard={onViewLeaderboard}
      />
    ) : null;

  if (gameId === "drunk-walk") {
    const handleChangeCharacter = (next: DrunkWalkCharacter): void => {
      setCharacter(next);
      storeDrunkWalkCharacter(next);
    };
    return (
      <>
        <RealtimePlayScreen<DrunkWalkState, DrunkWalkInput>
          module={drunkWalk}
          gameTitle={title}
          seed={seed}
          inputSource={inputSource as InputSource<DrunkWalkInput>}
          renderScene={(props) => <DrunkWalkScene {...props} character={character} />}
          onExit={onExit}
          onRunComplete={onRunComplete}
          shareUrl={shareToken ?? buildShareUrl(gameId, lastScore)}
          resultExtra={rankPreview}
          {...challengeProps}
          {...navProps}
          surfaceExtra={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMenuOpen(true)}
              aria-label="Customize character"
            >
              <GearIcon />
            </Button>
          }
        />
        <DrunkWalkCustomizeMenu
          isOpen={menuOpen}
          character={character}
          onChange={handleChangeCharacter}
          onClose={() => setMenuOpen(false)}
        />
      </>
    );
  }

  if (gameId === "2048") {
    // The selected size chooses which registered module plays — and therefore
    // which leaderboard the run submits to (the loop reads `module.id`, so the
    // submit id follows automatically; only the rank read needs it explicitly).
    const module2048 = size === 3 ? game2048_3 : size === 5 ? game2048_5 : game2048;
    const rank2048 =
      onViewLeaderboard && settled ? (
        <RankPreview
          key={runKey}
          gameId={module2048.id}
          metric="score"
          onViewLeaderboard={onViewLeaderboard}
        />
      ) : null;
    const handleChangeSize = (next: Game2048Size): void => {
      setSize(next);
      store2048Size(next);
      // Picking a size is a complete choice — close the sheet so the fresh run
      // is visible immediately rather than behind the still-open picker.
      setMenuOpen(false);
    };
    return (
      <>
        <RealtimePlayScreen<Game2048State, Game2048Input>
          // Remount on a size change: a different grid is a different game, so the
          // run resets cleanly to a fresh `ready` state built by the new module.
          key={size}
          module={module2048}
          gameTitle={title}
          seed={seed}
          inputSource={inputSource as InputSource<Game2048Input>}
          renderScene={(props) => <Game2048Scene {...props} />}
          onExit={onExit}
          onRunComplete={onRunComplete}
          shareUrl={shareToken ?? buildShareUrl(gameId, lastScore)}
          resultExtra={rank2048}
          {...challengeProps}
          {...navProps}
          surfaceExtra={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMenuOpen(true)}
              aria-label="Change board size"
            >
              <GearIcon />
            </Button>
          }
        />
        <Game2048CustomizeMenu
          isOpen={menuOpen}
          size={size}
          onChange={handleChangeSize}
          onClose={() => setMenuOpen(false)}
        />
      </>
    );
  }

  return (
    <RealtimePlayScreen
      module={wiring.module}
      gameTitle={title}
      seed={seed}
      inputSource={inputSource}
      renderScene={wiring.renderScene}
      onExit={onExit}
      onRunComplete={onRunComplete}
      shareUrl={shareToken ?? buildShareUrl(gameId, lastScore)}
      resultExtra={rankPreview}
      {...challengeProps}
      {...navProps}
    />
  );
}
