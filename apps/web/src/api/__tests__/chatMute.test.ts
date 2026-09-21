import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMutedTokens,
  isTokenMuted,
  muteToken,
  onMuteChange,
  unmuteToken,
} from "../chatMute";

describe("chatMute", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("starts with an empty muted set", () => {
    expect(getMutedTokens().size).toBe(0);
    expect(isTokenMuted("tok-a")).toBe(false);
  });

  it("mutes and unmutes by token, keying off the token not any name", () => {
    muteToken("tok-a");
    expect(isTokenMuted("tok-a")).toBe(true);
    expect(isTokenMuted("tok-b")).toBe(false);

    unmuteToken("tok-a");
    expect(isTokenMuted("tok-a")).toBe(false);
  });

  it("persists across a fresh read (localStorage), not just in-memory", () => {
    muteToken("tok-persist");
    expect(getMutedTokens().has("tok-persist")).toBe(true);
    // A brand-new read (simulating a reload) still sees it.
    expect(new Set(JSON.parse(window.localStorage.getItem("mpg_chat_muted_tokens") ?? "[]"))).toEqual(
      new Set(["tok-persist"]),
    );
  });

  it("notifies subscribers on mute/unmute", () => {
    const listener = vi.fn();
    const unsubscribe = onMuteChange(listener);

    muteToken("tok-a");
    expect(listener).toHaveBeenCalledTimes(1);

    unmuteToken("tok-a");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    muteToken("tok-b");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("is a no-op (and doesn't throw) muting an already-muted token", () => {
    muteToken("tok-a");
    const listener = vi.fn();
    onMuteChange(listener);
    muteToken("tok-a");
    expect(listener).not.toHaveBeenCalled();
  });

  it("degrades gracefully if localStorage throws", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => getMutedTokens()).not.toThrow();
    expect(getMutedTokens().size).toBe(0);
  });
});
