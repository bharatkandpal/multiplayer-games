import { describe, expect, it } from "vitest";

import { MAX_ROOM_SECRET_LENGTH, channelNameFor, normalizeRoomSecret } from "../privateChannel.js";

const KEY = "keyName.abc:secret";

describe("normalizeRoomSecret", () => {
  it("treats a missing/blank secret as a public room", () => {
    expect(normalizeRoomSecret(undefined)).toEqual({ ok: true, secret: null });
    expect(normalizeRoomSecret(null)).toEqual({ ok: true, secret: null });
    expect(normalizeRoomSecret("")).toEqual({ ok: true, secret: null });
    expect(normalizeRoomSecret("   ")).toEqual({ ok: true, secret: null });
  });

  it("trims a usable secret so whitespace never splits a room", () => {
    expect(normalizeRoomSecret("  royal  ")).toEqual({ ok: true, secret: "royal" });
  });

  it("rejects a non-string or an over-long secret", () => {
    expect(normalizeRoomSecret(42)).toEqual({ ok: false });
    expect(normalizeRoomSecret({})).toEqual({ ok: false });
    expect(normalizeRoomSecret("x".repeat(MAX_ROOM_SECRET_LENGTH + 1))).toEqual({ ok: false });
  });
});

describe("channelNameFor", () => {
  it("keeps the plain public channel when there is no secret", () => {
    expect(channelNameFor("lobby", null, KEY)).toBe("chat:lobby");
  });

  it("derives an opaque, stable private channel from (roomId, secret)", () => {
    const a = channelNameFor("poker", "royal", KEY);
    expect(a).toMatch(/^chat:p-[0-9a-f]{32}$/);
    // Deterministic — the same inputs always name the same channel, so everyone
    // who types the secret lands together.
    expect(channelNameFor("poker", "royal", KEY)).toBe(a);
  });

  it("separates rooms, secrets, and keys", () => {
    const base = channelNameFor("poker", "royal", KEY);
    // Same secret, different room → different channel (roomId is folded in).
    expect(channelNameFor("bridge", "royal", KEY)).not.toBe(base);
    // Same room, different secret → different channel.
    expect(channelNameFor("poker", "flush", KEY)).not.toBe(base);
    // Same room+secret, different server key → different channel (keyed HMAC).
    expect(channelNameFor("poker", "royal", "other-key")).not.toBe(base);
  });

  it("never collides a private channel with any public one", () => {
    // A private channel lives in the `p-` namespace; a public room named the
    // same way would need to *be* a 32-hex string, which no human slug is.
    expect(channelNameFor("poker", "royal", KEY).startsWith("chat:p-")).toBe(true);
    expect(channelNameFor("p-anything", null, KEY)).toBe("chat:p-anything");
  });
});
