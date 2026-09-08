import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { submitRealtimeScore } from "../leaderboard.js";

const STORAGE_KEY = "mpg_session_token";

/** The exact payload the server's submit route validates — see leaderboardRoutes.ts. */
const SUBMISSION = {
  runId: "run-1234",
  seed: 4242,
  score: 17,
  inputLog: [{ tap: "left" }, { tap: null }, { tap: "right" }],
} as const;

describe("submitRealtimeScore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("POSTs the {runId, seed, score, inputLog} body the submit route expects", async () => {
    window.localStorage.setItem(STORAGE_KEY, "session-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, entry: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await submitRealtimeScore("drunk-walk", SUBMISSION);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/api/leaderboard/drunk-walk/submit");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      runId: "run-1234",
      seed: 4242,
      score: 17,
      inputLog: [{ tap: "left" }, { tap: null }, { tap: "right" }],
    });
    // Session-scoped: ownership of the entry binds to this token (MPG-054).
    expect(new Headers(init.headers).get("x-session-token")).toBe("session-token");
  });

  it("rejects on a 422 SCORE_MISMATCH so the caller can degrade instead of trusting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ error: "SCORE_MISMATCH" }),
      }),
    );

    await expect(submitRealtimeScore("drunk-walk", SUBMISSION)).rejects.toThrow("422");
  });
});
