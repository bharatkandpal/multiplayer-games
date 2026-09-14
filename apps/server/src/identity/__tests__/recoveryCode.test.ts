import { describe, expect, it } from "vitest";

import {
  RECOVERY_CODE_LENGTH,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "../recoveryCode.js";

describe("recoveryCode", () => {
  it("generates a dash-grouped code of the expected symbol count", () => {
    const code = generateRecoveryCode();
    expect(normalizeRecoveryCode(code)).toHaveLength(RECOVERY_CODE_LENGTH);
    expect(code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
  });

  it("avoids visually ambiguous characters (0 O 1 I L U)", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateRecoveryCode()).not.toMatch(/[01OILU]/);
    }
  });

  it("generates distinct codes", () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(100);
  });

  it("hashes case- and format-insensitively", () => {
    const code = generateRecoveryCode();
    const lower = code.toLowerCase().replace(/-/g, " ");
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(lower));
  });

  it("different codes hash differently, and the hash is not the plaintext", () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(hashRecoveryCode(a)).not.toBe(hashRecoveryCode(b));
    expect(hashRecoveryCode(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(a)).not.toContain(normalizeRecoveryCode(a));
  });
});
