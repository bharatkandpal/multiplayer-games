// Per-game wiring between the generic `RealtimePlayScreen`/`useRealtimeLoop`
// and each concrete `RealtimeModule` + its renderer — the real-time sibling of
// `screens/games.tsx` (ADR 0002 §2: "a small map from realtime id →
// { module, renderer }"). Kept small and mechanical: all orchestration lives in
// the shared, engine- and renderer-agnostic `RealtimePlayScreen`.

import { useState, type ReactNode } from "react";
import {
  floppyBirds,
  type FloppyInput,
  type FloppyState,
  type RealtimeGameId,
  type RealtimeModule,
} from "@mpg/engine";
import { FloppyBirdsScene } from "../components/realtime/FloppyBirdsScene";
import {
  RealtimePlayScreen,
  type RealtimeControls,
  type RealtimeSceneProps,
} from "./RealtimePlayScreen";

/**
 * One catalog row of real-time wiring. `S`/`I` are erased at the map boundary
 * (a heterogeneous record can't keep each game's concrete generics) — the
 * factory below re-ties them per entry so every registration stays type-checked
 * against its own module/renderer/controls. `title` lives here for now; MPG-040f
 * folds the real-time games into the unified Home catalog (with a `kind` tag).
 */
export interface RealtimeGameWiring {
  readonly title: string;
  readonly module: RealtimeModule<unknown, unknown>;
  readonly renderScene: (props: RealtimeSceneProps<unknown>) => ReactNode;
  readonly controls: RealtimeControls<unknown>;
}

function defineRealtimeGame<S, I, A extends string>(
  title: string,
  module: RealtimeModule<S, I>,
  renderScene: (props: RealtimeSceneProps<S>) => ReactNode,
  controls: RealtimeControls<I, A>,
): RealtimeGameWiring {
  return { title, module, renderScene, controls } as unknown as RealtimeGameWiring;
}

const floppyControls: RealtimeControls<FloppyInput, "flap"> = {
  primaryAction: "flap",
  keyMap: { Space: "flap", ArrowUp: "flap" },
  toInput: (pressed) => ({ flap: pressed.has("flap") }),
  actionHint: "Tap, Space, or ↑ to flap",
};

/**
 * The real-time catalog. `Partial` like the turn-based `GAME_CATALOG`:
 * `RealtimeGameId` already includes `"lumberjack"` (MPG-041), which isn't built
 * yet, so only registered games appear.
 */
export const REALTIME_GAMES: Partial<Record<RealtimeGameId, RealtimeGameWiring>> = {
  "floppy-birds": defineRealtimeGame<FloppyState, FloppyInput, "flap">(
    "Floppy Birds",
    floppyBirds,
    (props) => <FloppyBirdsScene {...props} />,
    floppyControls,
  ),
};

/** A fresh pseudo-random seed for a run — 16 bits is plenty for the PRNG. */
function makeSeed(): number {
  return (Date.now() & 0xffff) || 1;
}

export interface RealtimeGameRouteProps {
  gameId: RealtimeGameId;
  onExit: () => void;
}

/**
 * Resolves a real-time game id to its wiring and renders the shared
 * `RealtimePlayScreen`. The App router (MPG-040f) will send `kind: "realtime"`
 * catalog entries straight here (no `SetupScreen` — nothing to configure for a
 * solo run). The initial seed is fixed per mount so a given run is reproducible.
 */
export function RealtimeGameRoute({ gameId, onExit }: RealtimeGameRouteProps): React.JSX.Element | null {
  const [seed] = useState(makeSeed);
  const wiring = REALTIME_GAMES[gameId];
  if (!wiring) return null;

  return (
    <RealtimePlayScreen
      module={wiring.module}
      gameTitle={wiring.title}
      seed={seed}
      controls={wiring.controls}
      renderScene={wiring.renderScene}
      onExit={onExit}
    />
  );
}
