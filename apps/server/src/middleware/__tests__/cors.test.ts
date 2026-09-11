import { describe, expect, it } from "vitest";

import { parseCorsOrigin } from "../cors.js";

describe("parseCorsOrigin (MPG-021)", () => {
  it("defaults to wildcard when unset or blank", () => {
    expect(parseCorsOrigin(undefined)).toBe("*");
    expect(parseCorsOrigin("")).toBe("*");
    expect(parseCorsOrigin("   ")).toBe("*");
    expect(parseCorsOrigin(" , , ")).toBe("*");
  });

  it("returns a single origin as a string", () => {
    expect(parseCorsOrigin("https://play.example.com")).toBe("https://play.example.com");
    expect(parseCorsOrigin("  https://play.example.com  ")).toBe("https://play.example.com");
  });

  it("returns a comma-separated list as a trimmed allowlist array", () => {
    expect(parseCorsOrigin("https://a.com, https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("collapses to wildcard if any entry is a wildcard", () => {
    expect(parseCorsOrigin("https://a.com,*")).toBe("*");
  });
});
