import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBackendReachable } from "../useBackendReachable.js";

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("useBackendReachable (MPG-089-c)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("starts false and flips to true once the boot probe confirms reachability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { handle: null, claimed: false })),
    );
    const { result } = renderHook(() => useBackendReachable());

    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("OFFLINE PILLAR: stays false when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const { result } = renderHook(() => useBackendReachable());

    // Give the rejected probe a tick to settle, then confirm it never flips.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBe(false);
  });
});
