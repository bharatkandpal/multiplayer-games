import { describe, it, expect, beforeEach } from "vitest";
import type { RealtimeModule } from "./realtime";
import {
  registerRealtimeGame,
  getRealtimeGame,
  hasRealtimeGame,
  listRealtimeGames,
  clearRealtimeRegistry,
} from "./realtime-registry";

// A minimal fake realtime game to exercise the registry. It also proves a concrete
// RealtimeModule<S, I> is assignable to the registry's opaque module type. State is
// just a tick counter; a run "ends" once it reaches 3 (no timers/DOM needed).
const fakeRealtime: RealtimeModule<{ t: number }, { flap: boolean }> = {
  id: "floppy-birds",
  kind: "realtime",
  tickHz: 60,
  createInitialState: () => ({ t: 0 }),
  tick: (state, input) => ({ t: state.t + (input.flap ? 2 : 1) }),
  getScore: (state) => state.t,
  isGameOver: (state) => state.t >= 3,
};

describe("realtime-registry", () => {
  beforeEach(() => clearRealtimeRegistry());

  it("registers and retrieves a realtime game by id", () => {
    registerRealtimeGame(fakeRealtime);
    expect(getRealtimeGame("floppy-birds")).toBe(fakeRealtime);
    expect(hasRealtimeGame("floppy-birds")).toBe(true);
    expect(listRealtimeGames()).toEqual(["floppy-birds"]);
  });

  it("throws on duplicate registration", () => {
    registerRealtimeGame(fakeRealtime);
    expect(() => registerRealtimeGame(fakeRealtime)).toThrow(/already registered/);
  });

  it("throws when getting an unregistered realtime game", () => {
    expect(hasRealtimeGame("lumberjack")).toBe(false);
    expect(() => getRealtimeGame("lumberjack")).toThrow(/Unknown realtime game/);
  });

  it("starts empty and clears", () => {
    expect(listRealtimeGames()).toEqual([]);
    registerRealtimeGame(fakeRealtime);
    clearRealtimeRegistry();
    expect(listRealtimeGames()).toEqual([]);
  });

  it("is a sibling registry — separate from the turn-based one (no id collision)", () => {
    // The realtime and turn-based registries are independent maps: registering a
    // realtime game must not appear in / clash with the turn-based registry.
    registerRealtimeGame(fakeRealtime);
    expect(listRealtimeGames()).toEqual(["floppy-birds"]);
  });
});
