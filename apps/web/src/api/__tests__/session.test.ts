import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_HEADER,
  apiFetch,
  clearSession,
  getSessionToken,
  initSession,
} from "../session.js";

const STORAGE_KEY = "mpg_session_token";

describe("session client", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  describe("getSessionToken", () => {
    it("returns null when no token is cached", () => {
      expect(getSessionToken()).toBeNull();
    });

    it("returns the cached token", () => {
      window.localStorage.setItem(STORAGE_KEY, "cached-token");
      expect(getSessionToken()).toBe("cached-token");
    });
  });

  describe("initSession", () => {
    it("fetches a token from the server when none is cached", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: "new-token", createdAt: "2026-01-01T00:00:00.000Z" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const token = await initSession();

      expect(token).toBe("new-token");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/session",
        expect.objectContaining({ method: "GET" }),
      );
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("new-token");
    });

    it("returns the cached token without hitting the network", async () => {
      window.localStorage.setItem(STORAGE_KEY, "already-cached");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const token = await initSession();

      expect(token).toBe("already-cached");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("throws if the server responds with an error", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      vi.stubGlobal("fetch", fetchMock);

      await expect(initSession()).rejects.toThrow();
    });
  });

  describe("clearSession", () => {
    it("calls DELETE /api/session and removes the local token", async () => {
      window.localStorage.setItem(STORAGE_KEY, "to-delete");
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      vi.stubGlobal("fetch", fetchMock);

      await clearSession();

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/session",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({ [SESSION_HEADER]: "to-delete" }),
        }),
      );
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("clears local state even if the network call fails", async () => {
      window.localStorage.setItem(STORAGE_KEY, "to-delete");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

      await clearSession();

      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("is a no-op network-wise when there is no token", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await clearSession();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("apiFetch", () => {
    it("attaches the session token header when a token is cached", async () => {
      window.localStorage.setItem(STORAGE_KEY, "req-token");
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      await apiFetch("/api/session/history");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Headers;
      expect(headers.get(SESSION_HEADER)).toBe("req-token");
    });

    it("does not attach a header when no token is cached", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      await apiFetch("/api/session/history");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Headers;
      expect(headers.get(SESSION_HEADER)).toBeNull();
    });
  });
});
