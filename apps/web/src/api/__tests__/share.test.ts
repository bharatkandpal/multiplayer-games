import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DeadShareLinkError,
  createShareLink,
  fetchSharedView,
  revokeShareLink,
  shareUrlForToken,
} from "../share.js";

const STORAGE_KEY = "mpg_session_token";

describe("share link client (MPG-056)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("POSTs {kind, targetId} and returns the minted link", async () => {
    window.localStorage.setItem(STORAGE_KEY, "session-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ token: "tok-1", kind: "result", createdAt: "x", expiresAt: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const link = await createShareLink({ kind: "result", targetId: "res-1" });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/api/share");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ kind: "result", targetId: "res-1" });
    expect(link.token).toBe("tok-1");
  });

  it("resolves a shared view by token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ kind: "result", result: { gameId: "floppy-birds", score: 12 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = await fetchSharedView("tok-1");

    expect((fetchMock.mock.calls[0]! as [string])[0]).toContain("/api/share/tok-1");
    expect(view).toEqual({ kind: "result", result: { gameId: "floppy-birds", score: 12 } });
  });

  it("throws a DISTINCT error for a dead link, so the UI can tell it from a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchSharedView("gone")).rejects.toBeInstanceOf(DeadShareLinkError);

    // A 500 is retryable and must NOT be reported as a dead link.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const error = await fetchSharedView("boom").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeadShareLinkError);
  });

  it("percent-encodes the token rather than splicing it into the path raw", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await fetchSharedView("a/b?c");

    const [url] = fetchMock.mock.calls[0]! as [string];
    expect(url).toContain("/api/share/a%2Fb%3Fc");
  });

  it("reports revocation by status, not by body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    expect(await revokeShareLink("tok-1")).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await revokeShareLink("tok-1")).toBe(false);
  });

  it("builds the in-app /s/:token URL", () => {
    expect(shareUrlForToken("tok-1")).toBe(`${window.location.origin}/s/tok-1`);
  });
});
