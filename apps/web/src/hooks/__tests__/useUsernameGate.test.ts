import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useUsernameGate } from "../useUsernameGate.js";
import { getStoredUsername } from "../../api/username.js";

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("useUsernameGate", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("calls onReady immediately when a username is already cached, without opening the picker", () => {
    window.localStorage.setItem(
      "mpg_username",
      JSON.stringify({ name: "bharat_k", confirmed: true }),
    );
    const { result } = renderHook(() => useUsernameGate());
    const onReady = vi.fn();

    act(() => result.current.requireUsername(onReady));

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(false);
  });

  it("opens the picker when no username is cached, and proceeds on submit without waiting on the network", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { username: "bharat_k" })));
    const { result } = renderHook(() => useUsernameGate());
    const onReady = vi.fn();

    act(() => result.current.requireUsername(onReady));
    expect(result.current.isOpen).toBe(true);
    expect(onReady).not.toHaveBeenCalled();

    act(() => result.current.handleSubmit("bharat_k"));

    // Local save + onReady fire synchronously — no `await` needed.
    expect(getStoredUsername()).toBe("bharat_k");
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(false);
  });

  it("does not open or block anything when the background sync fails (backend down)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useUsernameGate());
    const onReady = vi.fn();

    act(() => result.current.requireUsername(onReady));
    act(() => result.current.handleSubmit("bharat_k"));

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(false);

    // Give the fire-and-forget sync a tick to settle; still nothing surfaced.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.collisionMessage).toBeUndefined();
  });

  it("reopens the picker with an inline error when a background sync finds a genuine collision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { error: "USERNAME_TAKEN" })),
    );
    const { result } = renderHook(() => useUsernameGate());
    const onReady = vi.fn();

    act(() => result.current.requireUsername(onReady));
    act(() => result.current.handleSubmit("taken_name"));

    // Proceeded immediately regardless.
    expect(onReady).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(result.current.isOpen).toBe(true));
    expect(result.current.collisionMessage).toMatch(/taken/i);
  });

  it("calls onCancelled and closes on cancel", () => {
    const onCancelled = vi.fn();
    const { result } = renderHook(() => useUsernameGate(onCancelled));

    act(() => result.current.requireUsername(vi.fn()));
    act(() => result.current.handleCancel());

    expect(result.current.isOpen).toBe(false);
    expect(onCancelled).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes its collision listener on unmount", () => {
    const { unmount } = renderHook(() => useUsernameGate());
    // No direct assertion possible without reaching into internals — this is
    // primarily a regression guard against a thrown error on unmount.
    expect(() => unmount()).not.toThrow();
  });
});
