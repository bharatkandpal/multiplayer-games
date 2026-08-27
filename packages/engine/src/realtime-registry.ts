import type { RealtimeGameId, RealtimeModule } from "./realtime";

/**
 * A registered realtime module whose concrete State/Input types are opaque to the
 * registry (mirrors {@link AnyGameModule}). Callers that know a game's id also know
 * its concrete types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRealtimeModule = RealtimeModule<any, any>;

// A SIBLING registry to the turn-based one (ADR 0002 §3): keeping the two module
// families in separate maps means `GameModule`'s types never absorb realtime
// concerns, protecting the MPG-031 plugin boundary.
const registry = new Map<RealtimeGameId, AnyRealtimeModule>();

/** Register a realtime game. Throws if a module with the same id is already registered. */
export function registerRealtimeGame(module: AnyRealtimeModule): void {
  if (registry.has(module.id)) {
    throw new Error(`Realtime game already registered: ${module.id}`);
  }
  registry.set(module.id, module);
}

/** Look up a registered realtime game by id. Throws if it is not registered. */
export function getRealtimeGame(id: RealtimeGameId): AnyRealtimeModule {
  const module = registry.get(id);
  if (!module) {
    throw new Error(`Unknown realtime game: ${id}`);
  }
  return module;
}

/** Whether a realtime game id is registered. */
export function hasRealtimeGame(id: RealtimeGameId): boolean {
  return registry.has(id);
}

/** Ids of all registered realtime games. */
export function listRealtimeGames(): RealtimeGameId[] {
  return [...registry.keys()];
}

/** Remove all realtime registrations. Intended for tests. */
export function clearRealtimeRegistry(): void {
  registry.clear();
}
