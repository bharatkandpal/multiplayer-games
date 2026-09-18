import { describe, expect, it } from "vitest";

import { isValidUsernameFormat } from "../username.js";
import {
  ADJECTIVES,
  ANIMALS,
  USERNAME_COMBINATIONS,
  generateUsername,
  generateUsernameWithSuffix,
} from "../usernameWords.js";

describe("username word list", () => {
  it("has two non-trivial, duplicate-free parts of short lowercase words", () => {
    for (const list of [ADJECTIVES, ANIMALS]) {
      expect(list.length).toBeGreaterThanOrEqual(20);
      expect(new Set(list).size).toBe(list.length); // no duplicates
      for (const word of list) {
        expect(word).toMatch(/^[a-z]+$/);
        expect(word.length).toBeLessThanOrEqual(9);
      }
    }
  });

  it("reports the combination count", () => {
    expect(USERNAME_COMBINATIONS).toBe(ADJECTIVES.length * ANIMALS.length);
  });

  it("every adjective+animal combination is a valid username", () => {
    // The load-bearing contract: no pairing may violate the server's 3–20 char
    // rule, or the auto-assign could produce a name the server rejects.
    for (const adjective of ADJECTIVES) {
      for (const animal of ANIMALS) {
        const combined = `${adjective}${animal.charAt(0).toUpperCase()}${animal.slice(1)}`;
        expect(isValidUsernameFormat(combined)).toBe(true);
      }
    }
  });

  it("generateUsername always returns a valid, camelCased name", () => {
    for (let i = 0; i < 200; i += 1) {
      const name = generateUsername();
      expect(isValidUsernameFormat(name)).toBe(true);
      expect(name).toMatch(/^[a-z]+[A-Z][a-z]+$/);
    }
  });

  it("generateUsernameWithSuffix stays valid and within the length limit", () => {
    for (let i = 0; i < 200; i += 1) {
      const name = generateUsernameWithSuffix();
      expect(isValidUsernameFormat(name)).toBe(true);
      expect(name).toMatch(/[0-9]{2}$/);
    }
  });
});
