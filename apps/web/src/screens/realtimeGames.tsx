// Per-game wiring between the generic `RealtimePlayScreen`/`useRealtimeLoop`
// and each concrete `RealtimeModule` + its renderer — the real-time sibling of
// `screens/games.tsx` (ADR 0002 §2: "a small map from realtime id →
// { module, renderer }"). Kept small and mechanical: all orchestration lives in
// the shared, engine- and renderer-agnostic `RealtimePlayScreen`.

import { useState, type ReactNode } from "react";
import {
  drunkWalk,
  floppyBirds,
  reflexTest,
  type DrunkWalkInput,
  type DrunkWalkState,
  type FloppyInput,
  type FloppyState,
  type RealtimeGameId,
  type RealtimeModule,
  type ReflexInput,
  type ReflexState,
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
import { Button, GearIcon } from "../components/ui";
import {
  RealtimePlayScreen,
  type RealtimeControls,
  type RealtimeSceneProps,
} from "./RealtimePlayScreen";
import { REALTIME_CATALOG } from "./HomeScreen";
import { RankPreview } from "./RankPreview";
import { submitRealtimeScore } from "../api/leaderboard";
import { createShareLink, shareUrlForToken } from "../api/share";
import type { RunComplete } from "../game/useRealtimeLoop";

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
  readonly controls: RealtimeControls<unknown>;
}

function defineRealtimeGame<S, I, A extends string>(
  module: RealtimeModule<S, I>,
  renderScene: (props: RealtimeSceneProps<S>) => ReactNode,
  controls: RealtimeControls<I, A>,
): RealtimeGameWiring {
  return { module, renderScene, controls } as unknown as RealtimeGameWiring;
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
};

/** A fresh pseudo-random seed for a run — 16 bits is plenty for the PRNG. */
function makeSeed(): number {
  return Date.now() & 0xffff || 1;
}

/**
 * Where a share falls back to when there is no durable result link (MPG-087):
 * the game's own URL. Still the right fallback — "here's the game" beats a
 * button that does nothing — but the durable per-result link (MPG-056) is what
 * a finished run shares whenever one could be minted.
 */
function buildShareUrl(gameId: RealtimeGameId): string {
  const path = `/${gameId}`;
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

/**
 * Mints the durable share link for a finished run (MPG-056), returning the
 * `/s/:token` URL to hand the share button.
 *
 * Minted EAGERLY when the run settles rather than lazily on the share tap, and
 * that ordering is deliberate: `navigator.share` must be called inside the
 * user's gesture, and awaiting a network round-trip first breaks the gesture on
 * some mobile browsers — the sheet then silently never opens. The cost is a
 * share_link row per completed run whether or not it is ever shared, which is
 * what the row's optional expiry and the retention sweep exist to bound.
 */
function mintResultLink(resultId: string): Promise<string | undefined> {
  return createShareLink({ kind: "result", targetId: resultId })
    .then((link) => shareUrlForToken(link.token))
    .catch((error: unknown) => {
      // Never break sharing over this: the caller falls back to the game URL.
      console.warn("[share] could not mint a durable result link", error);
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
  onRunComplete: (r: RunComplete<unknown>) => void;
} {
  // `runKey` is bumped per run so the preview remounts (and refetches) on every
  // game over, not just the first; `settled` hides it while a submission is in
  // flight, so the player never sees the PREVIOUS run's rank under this one's score.
  const [{ runKey, settled }, setRun] = useState({ runKey: 0, settled: false });
  // The durable `/s/:token` URL for the run just finished. Cleared at the start
  // of each run so one run's link can never be shared under the next run's score.
  const [shareToken, setShareToken] = useState<string | undefined>(undefined);

  const onRunComplete = (result: RunComplete<unknown>): void => {
    setRun((prev) => ({ ...prev, settled: false }));
    setShareToken(undefined);
    void submitRun(result).then(async (resultId) => {
      // The rank is readable the moment the score write lands; don't make it
      // wait on the share link, which is a separate, optional round-trip.
      setRun((prev) => ({ runKey: prev.runKey + 1, settled: true }));
      if (resultId) setShareToken(await mintResultLink(resultId));
    });
  };

  return { runKey, settled, shareToken, onRunComplete };
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
}: RealtimeGameRouteProps): React.JSX.Element | null {
  const [seed] = useState(makeSeed);
  const { runKey, settled, shareToken, onRunComplete } = useSettledRun();
  // Only meaningful for "drunk-walk" (the one game with a character to
  // customize), but declared unconditionally so this component's hook
  // count/order stays stable across `gameId` values.
  const [character, setCharacter] = useState<DrunkWalkCharacter>(() =>
    gameId === "drunk-walk" ? loadStoredDrunkWalkCharacter() : DEFAULT_DRUNK_WALK_CHARACTER,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const wiring = REALTIME_GAMES[gameId];
  if (!wiring) return null;

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
        <RealtimePlayScreen<DrunkWalkState, DrunkWalkInput, "left" | "right">
          module={drunkWalk}
          gameTitle={title}
          seed={seed}
          controls={drunkWalkControls}
          renderScene={(props) => <DrunkWalkScene {...props} character={character} />}
          onExit={onExit}
          onRunComplete={onRunComplete}
          shareUrl={shareToken ?? buildShareUrl(gameId)}
          resultExtra={rankPreview}
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

  return (
    <RealtimePlayScreen
      module={wiring.module}
      gameTitle={title}
      seed={seed}
      controls={wiring.controls}
      renderScene={wiring.renderScene}
      onExit={onExit}
      onRunComplete={onRunComplete}
      shareUrl={shareToken ?? buildShareUrl(gameId)}
      resultExtra={rankPreview}
    />
  );
}
