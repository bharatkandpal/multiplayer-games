import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_ROOM_ID,
  isPrivateRoomSearch,
  isValidRoomId,
  roomLabel,
  roomPath,
  roomShareUrl,
  slugifyRoomName,
} from "../chatRoom";

describe("chatRoom", () => {
  describe("slugifyRoomName", () => {
    it("lowercases and hyphenates a friendly name into a valid id", () => {
      const slug = slugifyRoomName("Team Standup!");
      expect(slug).toBe("team-standup");
      expect(slug && isValidRoomId(slug)).toBe(true);
    });

    it("collapses runs and trims stray hyphens", () => {
      expect(slugifyRoomName("  --Weekend   Games!!--  ")).toBe("weekend-games");
    });

    it("keeps already-valid characters (underscore, digits, hyphen)", () => {
      expect(slugifyRoomName("room_42-b")).toBe("room_42-b");
    });

    it("caps at 64 chars without leaving a trailing hyphen", () => {
      const slug = slugifyRoomName("a b".repeat(40)); // "a ba ba b..." → long
      expect(slug).not.toBeNull();
      expect(slug!.length).toBeLessThanOrEqual(64);
      expect(slug!.endsWith("-")).toBe(false);
      expect(isValidRoomId(slug!)).toBe(true);
    });

    it("returns null when nothing usable survives", () => {
      expect(slugifyRoomName("   ")).toBeNull();
      expect(slugifyRoomName("!!!")).toBeNull();
      expect(slugifyRoomName("")).toBeNull();
    });
  });

  describe("roomLabel / roomPath / roomShareUrl", () => {
    it("gives the lobby a friendly label and the bare /chat path", () => {
      expect(roomLabel(DEFAULT_CHAT_ROOM_ID)).toBe("Lobby");
      expect(roomPath(DEFAULT_CHAT_ROOM_ID)).toBe("/chat");
      expect(roomShareUrl(DEFAULT_CHAT_ROOM_ID, "https://mpg.example")).toBe(
        "https://mpg.example/chat",
      );
    });

    it("shows a named room as-is and scopes its path/url", () => {
      expect(roomLabel("my-room")).toBe("my-room");
      expect(roomPath("my-room")).toBe("/chat/my-room");
      expect(roomShareUrl("my-room", "https://mpg.example")).toBe(
        "https://mpg.example/chat/my-room",
      );
    });
  });

  describe("private-room links (CHAT-020)", () => {
    it("marks a private path/url with ?p=1 and leaves public ones untouched", () => {
      expect(roomPath("my-room", { private: true })).toBe("/chat/my-room?p=1");
      expect(roomPath("my-room", { private: false })).toBe("/chat/my-room");
      expect(roomPath(DEFAULT_CHAT_ROOM_ID, { private: true })).toBe("/chat?p=1");
      expect(roomShareUrl("my-room", "https://mpg.example", { private: true })).toBe(
        "https://mpg.example/chat/my-room?p=1",
      );
    });

    it("reads the private marker off a search string", () => {
      expect(isPrivateRoomSearch("?p=1")).toBe(true);
      expect(isPrivateRoomSearch("?foo=bar&p=1")).toBe(true);
      expect(isPrivateRoomSearch("")).toBe(false);
      expect(isPrivateRoomSearch("?p=0")).toBe(false);
      expect(isPrivateRoomSearch("?private=1")).toBe(false);
    });
  });
});
