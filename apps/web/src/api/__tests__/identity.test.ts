import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adoptIdentity,
  claimHandle,
  fetchIdentity,
  getStoredHandle,
  isValidHandleFormat,
  isValidRecoveryCodeFormat,
  noteValueMoment,
  normalizeRecoveryCode,
  onValueMoment,
} from "../identity.js";

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("identity client", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  describe("format helpers", () => {
    it("validates handle format (3–20, alnum + _ -)", () => {
      expect(isValidHandleFormat("nova")).toBe(true);
      expect(isValidHandleFormat("ab")).toBe(false);
      expect(isValidHandleFormat("a".repeat(21))).toBe(false);
      expect(isValidHandleFormat("bad name!")).toBe(false);
    });

    it("normalizes and validates a recovery code (16 significant symbols)", () => {
      expect(normalizeRecoveryCode("k7qn-4fh2 abcd ejkm")).toBe("K7QN4FH2ABCDEJKM");
      expect(isValidRecoveryCodeFormat("K7QN-4FH2-ABCD-EJKM")).toBe(true);
      expect(isValidRecoveryCodeFormat("k7qn 4fh2 abcd ejkm")).toBe(true);
      expect(isValidRecoveryCodeFormat("too-short")).toBe(false);
    });
  });

  describe("fetchIdentity", () => {
    it("returns the claimed state and caches the handle", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(200, { handle: "Nova", claimed: true })),
      );
      const state = await fetchIdentity();
      expect(state).toEqual({ handle: "Nova", claimed: true });
      expect(getStoredHandle()).toBe("Nova");
    });

    it("returns an unclaimed answer without caching a handle", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(200, { handle: null, claimed: false })),
      );
      expect(await fetchIdentity()).toEqual({ handle: null, claimed: false });
      expect(getStoredHandle()).toBeNull();
    });

    it("resolves to null (unknown) when the backend is unreachable", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
      expect(await fetchIdentity()).toBeNull();
    });

    it("resolves to null on a 5xx", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));
      expect(await fetchIdentity()).toBeNull();
    });
  });

  describe("claimHandle", () => {
    it("returns the recovery code once on success and caches the handle", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(201, { handle: "Nova", recoveryCode: "K7QN-4FH2-ABCD-EJKM" }),
          ),
      );
      const result = await claimHandle("Nova");
      expect(result).toEqual({ ok: true, handle: "Nova", recoveryCode: "K7QN-4FH2-ABCD-EJKM" });
      expect(getStoredHandle()).toBe("Nova");
    });

    it("maps 409 HANDLE_TAKEN to reason 'taken'", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(409, { error: "HANDLE_TAKEN" })),
      );
      expect(await claimHandle("Nova")).toEqual({ ok: false, reason: "taken" });
    });

    it("maps 409 ALREADY_CLAIMED to reason 'already_claimed'", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(409, { error: "ALREADY_CLAIMED" })),
      );
      expect(await claimHandle("Nova")).toEqual({ ok: false, reason: "already_claimed" });
    });

    it("maps 400 to reason 'invalid'", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(400, { error: "INVALID_HANDLE" })),
      );
      expect(await claimHandle("Nova")).toEqual({ ok: false, reason: "invalid" });
    });

    it("maps a network failure to reason 'offline'", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
      expect(await claimHandle("Nova")).toEqual({ ok: false, reason: "offline" });
    });
  });

  describe("adoptIdentity", () => {
    it("returns the handle on success and caches it", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { handle: "Nova" })));
      expect(await adoptIdentity("K7QN-4FH2-ABCD-EJKM")).toEqual({ ok: true, handle: "Nova" });
      expect(getStoredHandle()).toBe("Nova");
    });

    it("maps 400 to reason 'invalid'", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(400, { error: "INVALID_RECOVERY_CODE" })),
      );
      expect(await adoptIdentity("nope")).toEqual({ ok: false, reason: "invalid" });
    });

    it("maps a network failure to reason 'offline'", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
      expect(await adoptIdentity("K7QN-4FH2-ABCD-EJKM")).toEqual({ ok: false, reason: "offline" });
    });
  });

  describe("value-moment emitter", () => {
    it("notifies subscribers and stops after unsubscribe", () => {
      const listener = vi.fn();
      const unsubscribe = onValueMoment(listener);
      noteValueMoment();
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
      noteValueMoment();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
