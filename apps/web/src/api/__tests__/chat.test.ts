import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChatToken, sendChatMessage } from "../chat";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("api/chat", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("fetchChatToken", () => {
    it("resolves the token payload on success", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonResponse({
            tokenRequest: { token: "t" },
            channelName: "chat:lobby",
            clientId: "c1",
          }),
        ),
      );

      const result = await fetchChatToken("lobby");
      expect(result).toEqual({
        tokenRequest: { token: "t" },
        channelName: "chat:lobby",
        clientId: "c1",
      });
    });

    it("degrades to null on a 503 (chat_unavailable), never throwing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({ error: "chat_unavailable" }, 503)),
      );

      const result = await fetchChatToken("lobby");
      expect(result).toBeNull();
    });

    it("degrades to null on a network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

      const result = await fetchChatToken("lobby");
      expect(result).toBeNull();
    });
  });

  describe("sendChatMessage", () => {
    it("resolves ok on 202", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ id: "m1", ts: 123 }, 202)));

      const result = await sendChatMessage("lobby", "hi", "Ada");
      expect(result).toEqual({ ok: true, id: "m1", ts: 123 });
    });

    it("maps a 429 to rate_limited", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 429)));

      const result = await sendChatMessage("lobby", "hi", "Ada");
      expect(result).toEqual({ ok: false, reason: "rate_limited" });
    });

    it("maps a 503 and any network failure to unavailable, never throwing", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
      expect(await sendChatMessage("lobby", "hi", "Ada")).toEqual({
        ok: false,
        reason: "unavailable",
      });

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      expect(await sendChatMessage("lobby", "hi", "Ada")).toEqual({
        ok: false,
        reason: "unavailable",
      });
    });
  });
});
