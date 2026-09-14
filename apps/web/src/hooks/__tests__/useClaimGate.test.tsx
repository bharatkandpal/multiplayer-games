import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/**
 * `useClaimGate` keeps a module-level "auto-offered this load" flag, so each test
 * loads a fresh module graph to reset it. The hook and the identity module must
 * come from the SAME fresh graph so `noteValueMoment` reaches the hook's listener.
 */
async function loadFresh(): Promise<{
  useClaimGate: typeof import("../useClaimGate.js").useClaimGate;
  noteValueMoment: typeof import("../../api/identity.js").noteValueMoment;
}> {
  vi.resetModules();
  const identity = await import("../../api/identity.js");
  const { useClaimGate } = await import("../useClaimGate.js");
  return { useClaimGate, noteValueMoment: identity.noteValueMoment };
}

describe("useClaimGate", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("offers the claim prompt on a value moment when reachable and unclaimed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { handle: null, claimed: false })),
    );
    const { useClaimGate, noteValueMoment } = await loadFresh();
    const { result } = renderHook(() => useClaimGate());

    // Retry the fire until the boot probe has marked the backend reachable; the
    // gate no-ops (without consuming its one shot) while it isn't.
    await waitFor(() => {
      act(() => noteValueMoment());
      expect(result.current.isOpen).toBe(true);
    });
    expect(result.current.view).toBe("claim");
  });

  it("does NOT offer the prompt when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const { useClaimGate, noteValueMoment } = await loadFresh();
    const { result } = renderHook(() => useClaimGate());

    await act(async () => {
      await Promise.resolve();
    });
    act(() => noteValueMoment());
    expect(result.current.isOpen).toBe(false);
  });

  it("does NOT offer the prompt when already claimed", async () => {
    window.localStorage.setItem("mpg_handle", "Nova");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { handle: "Nova", claimed: true })),
    );
    const { useClaimGate, noteValueMoment } = await loadFresh();
    const { result } = renderHook(() => useClaimGate());

    await act(async () => {
      await Promise.resolve();
    });
    act(() => noteValueMoment());
    expect(result.current.isOpen).toBe(false);
  });

  it("moves to the recovery view and exposes the code after a successful claim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("/api/identity/claim")
          ? Promise.resolve(
              jsonResponse(201, { handle: "Nova", recoveryCode: "K7QN-4FH2-ABCD-EJKM" }),
            )
          : Promise.resolve(jsonResponse(200, { handle: null, claimed: false })),
      ),
    );
    const { useClaimGate } = await loadFresh();
    const { result } = renderHook(() => useClaimGate());

    act(() => result.current.openClaim());
    act(() => result.current.submitClaim("Nova"));

    await waitFor(() => expect(result.current.view).toBe("recovery"));
    expect(result.current.recoveryCode).toBe("K7QN-4FH2-ABCD-EJKM");
    expect(result.current.claimedHandle).toBe("Nova");
  });

  it("moves to the restored view after a successful adopt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("/api/identity/adopt")
          ? Promise.resolve(jsonResponse(200, { handle: "Nova" }))
          : Promise.resolve(jsonResponse(200, { handle: null, claimed: false })),
      ),
    );
    const { useClaimGate } = await loadFresh();
    const { result } = renderHook(() => useClaimGate());

    act(() => result.current.openClaim());
    act(() => result.current.switchToAdopt());
    act(() => result.current.submitAdopt("K7QN-4FH2-ABCD-EJKM"));

    await waitFor(() => expect(result.current.view).toBe("restored"));
    expect(result.current.claimedHandle).toBe("Nova");
  });

  it("keeps the claim modal open with an inline message when the claim goes offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("/api/identity/claim")
          ? Promise.reject(new Error("down"))
          : Promise.resolve(jsonResponse(200, { handle: null, claimed: false })),
      ),
    );
    const { useClaimGate } = await loadFresh();
    const { result } = renderHook(() => useClaimGate());

    act(() => result.current.openClaim());
    act(() => result.current.submitClaim("Nova"));

    await waitFor(() => expect(result.current.claimError).toMatch(/Couldn't reach the server/));
    expect(result.current.isOpen).toBe(true);
  });

  it("rejects a bad-format handle inline without a request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { handle: null, claimed: false }));
    vi.stubGlobal("fetch", fetchMock);
    const { useClaimGate } = await loadFresh();
    const { result } = renderHook(() => useClaimGate());

    act(() => result.current.openClaim());
    act(() => result.current.submitClaim("ab"));

    expect(result.current.claimError).toMatch(/3–20 characters/);
    // Only the boot probe hit the network — the invalid handle never did.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
