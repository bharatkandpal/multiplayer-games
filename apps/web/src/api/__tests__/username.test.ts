import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getStoredUsername,
  hasUnconfirmedUsername,
  isValidUsernameFormat,
  onUsernameCollision,
  reconcileUsername,
  setStoredUsername,
  syncUsername,
} from "../username.js";

const STORAGE_KEY = "mpg_username";

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("username client", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  describe("getStoredUsername / setStoredUsername", () => {
    it("returns null when nothing is stored", () => {
      expect(getStoredUsername()).toBeNull();
    });

    it("round-trips a locally-set name", () => {
      setStoredUsername("bharat_k");
      expect(getStoredUsername()).toBe("bharat_k");
    });

    it("falls back to null when storage is unavailable", () => {
      const spy = vi
        .spyOn(window.localStorage.__proto__, "getItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });
      expect(getStoredUsername()).toBeNull();
      spy.mockRestore();
    });

    it("falls back to null on malformed stored JSON", () => {
      window.localStorage.setItem(STORAGE_KEY, "not-json{{{");
      expect(getStoredUsername()).toBeNull();
    });

    it("does not throw when storage.setItem throws", () => {
      const spy = vi
        .spyOn(window.localStorage.__proto__, "setItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });
      expect(() => setStoredUsername("bharat_k")).not.toThrow();
      spy.mockRestore();
    });

    it("stores as unconfirmed by default", () => {
      setStoredUsername("bharat_k");
      expect(hasUnconfirmedUsername()).toBe(true);
    });
  });

  describe("isValidUsernameFormat", () => {
    it("accepts 3-20 char alphanumeric/_/- names", () => {
      expect(isValidUsernameFormat("abc")).toBe(true);
      expect(isValidUsernameFormat("a".repeat(20))).toBe(true);
      expect(isValidUsernameFormat("bharat_k-99")).toBe(true);
    });

    it("rejects too short, too long, or disallowed characters", () => {
      expect(isValidUsernameFormat("ab")).toBe(false);
      expect(isValidUsernameFormat("a".repeat(21))).toBe(false);
      expect(isValidUsernameFormat("bad name!")).toBe(false);
      expect(isValidUsernameFormat("")).toBe(false);
    });
  });

  describe("syncUsername", () => {
    it("marks the name confirmed on success", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(200, { token: "t", username: "bharat_k" })),
      );

      const result = await syncUsername("bharat_k");

      expect(result).toEqual({ ok: true, username: "bharat_k" });
      expect(getStoredUsername()).toBe("bharat_k");
      expect(hasUnconfirmedUsername()).toBe(false);
    });

    it("resolves 'taken' and notifies collision listeners on a 409", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(409, { error: "USERNAME_TAKEN" })),
      );
      const listener = vi.fn();
      const unsubscribe = onUsernameCollision(listener);

      const result = await syncUsername("taken_name");

      expect(result).toEqual({ ok: false, reason: "taken" });
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("resolves 'invalid' on a 400 without notifying collision listeners", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(400, { error: "INVALID_USERNAME" })),
      );
      const listener = vi.fn();
      const unsubscribe = onUsernameCollision(listener);

      const result = await syncUsername("bad name!");

      expect(result).toEqual({ ok: false, reason: "invalid" });
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    });

    it("resolves 'offline' (never throws) on a network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

      const result = await syncUsername("bharat_k");

      expect(result).toEqual({ ok: false, reason: "offline" });
    });

    it("resolves 'offline' on a 500", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));

      const result = await syncUsername("bharat_k");

      expect(result).toEqual({ ok: false, reason: "offline" });
    });
  });

  describe("reconcileUsername", () => {
    it("does nothing when there is no stored name", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await reconcileUsername();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does nothing when the stored name is already confirmed", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(200, { token: "t", username: "bharat_k" })),
      );
      await syncUsername("bharat_k"); // marks confirmed

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await reconcileUsername();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("retries an unconfirmed name and confirms it silently on success", async () => {
      setStoredUsername("bharat_k", false);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(200, { token: "t", username: "bharat_k" })),
      );

      await reconcileUsername();

      expect(hasUnconfirmedUsername()).toBe(false);
    });

    it("notifies collision listeners when the retry finds a genuine collision", async () => {
      setStoredUsername("bharat_k", false);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(409, { error: "USERNAME_TAKEN" })),
      );
      const listener = vi.fn();
      const unsubscribe = onUsernameCollision(listener);

      await reconcileUsername();

      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("stays silent (no throw, no listener call) when the backend is still unreachable", async () => {
      setStoredUsername("bharat_k", false);
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("still down")));
      const listener = vi.fn();
      const unsubscribe = onUsernameCollision(listener);

      await expect(reconcileUsername()).resolves.toBeUndefined();

      expect(listener).not.toHaveBeenCalled();
      expect(hasUnconfirmedUsername()).toBe(true);
      unsubscribe();
    });
  });
});
