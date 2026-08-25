import type { GameId, GameModule } from "./types";

/**
 * A registered module whose concrete State/Move types are opaque to the registry. The
 * registry stores heterogeneous games, so their generics are intentionally erased here;
 * callers that know a game's id also know its concrete types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameModule = GameModule<any, any>;

const registry = new Map<GameId, AnyGameModule>();

/** Register a game. Throws if a module with the same id is already registered. */
export function registerGame(module: AnyGameModule): void {
  if (registry.has(module.id)) {
    throw new Error(`Game already registered: ${module.id}`);
  }
  registry.set(module.id, module);
}

/** Look up a registered game by id. Throws if it is not registered. */
export function getGame(id: GameId): AnyGameModule {
  const module = registry.get(id);
  if (!module) {
    throw new Error(`Unknown game: ${id}`);
  }
  return module;
}

/** Whether a game id is registered. */
export function hasGame(id: GameId): boolean {
  return registry.has(id);
}

/** Ids of all registered games. */
export function listGames(): GameId[] {
  return [...registry.keys()];
}

/** Remove all registrations. Intended for tests. */
export function clearRegistry(): void {
  registry.clear();
}
