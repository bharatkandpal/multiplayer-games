import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isValidVariantNameFormat, saveVariant } from "../variants.js";

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("variants client (MPG-089-c)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  describe("isValidVariantNameFormat", () => {
    it("accepts 1-40 chars of letters/numbers/spaces/basic punctuation", () => {
      expect(isValidVariantNameFormat("Party Ghost")).toBe(true);
      expect(isValidVariantNameFormat("a")).toBe(true);
      expect(isValidVariantNameFormat("Björk's 2nd Look!")).toBe(true);
      expect(isValidVariantNameFormat("a".repeat(40))).toBe(true);
    });

    it("rejects empty, too-long, or out-of-charset names", () => {
      expect(isValidVariantNameFormat("")).toBe(false);
      expect(isValidVariantNameFormat("   ")).toBe(true); // format-only; caller trims first
      expect(isValidVariantNameFormat("a".repeat(41))).toBe(false);
      expect(isValidVariantNameFormat("bad<script>")).toBe(false);
      expect(isValidVariantNameFormat("emoji😀")).toBe(false);
    });
  });

  describe("saveVariant", () => {
    const input = {
      baseGameId: "drunk-walk",
      name: "Party Ghost",
      cosmetics: { hat: "party-hat" },
    };

    it("POSTs the variant and returns it with its auto-minted share link on 201", async () => {
      window.localStorage.setItem("mpg_session_token", "session-token");
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse(201, {
          variant: {
            id: "v1",
            name: "Party Ghost",
            baseGameId: "drunk-walk",
            cosmetics: { hat: "party-hat" },
            forkedFrom: null,
            createdAt: "2026-09-15T00:00:00.000Z",
          },
          share: {
            token: "tok-1",
            kind: "variant",
            createdAt: "2026-09-15T00:00:00.000Z",
            expiresAt: null,
          },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await saveVariant(input);

      const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
      expect(url).toContain("/api/variants");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual(input);
      expect(result).toEqual({
        ok: true,
        variant: {
          id: "v1",
          name: "Party Ghost",
          baseGameId: "drunk-walk",
          cosmetics: { hat: "party-hat" },
          forkedFrom: null,
          createdAt: "2026-09-15T00:00:00.000Z",
        },
        share: {
          token: "tok-1",
          kind: "variant",
          createdAt: "2026-09-15T00:00:00.000Z",
          expiresAt: null,
        },
      });
    });

    it("maps a 400 INVALID_VARIANT_NAME to reason 'invalid_name' with the server's detail", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(400, { error: "INVALID_VARIANT_NAME", reason: "PROFANITY" }),
          ),
      );
      expect(await saveVariant(input)).toEqual({
        ok: false,
        reason: "invalid_name",
        detail: "PROFANITY",
      });
    });

    it("maps a 400 INVALID_VARIANT/baseGameId to reason 'invalid_base_game'", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(jsonResponse(400, { error: "INVALID_VARIANT", reason: "baseGameId" })),
      );
      expect(await saveVariant(input)).toEqual({ ok: false, reason: "invalid_base_game" });
    });

    it("maps a 400 INVALID_VARIANT/cosmetics_* to reason 'invalid_cosmetics'", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(400, { error: "INVALID_VARIANT", reason: "cosmetics_not_object" }),
          ),
      );
      expect(await saveVariant(input)).toEqual({
        ok: false,
        reason: "invalid_cosmetics",
        detail: "cosmetics_not_object",
      });
    });

    it("never throws on a network failure — resolves to 'unavailable'", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
      await expect(saveVariant(input)).resolves.toEqual({ ok: false, reason: "unavailable" });
    });

    it("resolves to 'unavailable' on a non-400 error status (e.g. 5xx)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));
      expect(await saveVariant(input)).toEqual({ ok: false, reason: "unavailable" });
    });
  });
});
