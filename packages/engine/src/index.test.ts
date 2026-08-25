import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "./index";

// Smoke test to prove the Vitest wiring (MPG-002). Real engine tests: MPG-005 / MPG-006.
describe("@mpg/engine", () => {
  it("exposes a version", () => {
    expect(ENGINE_VERSION).toBe("0.0.0");
  });
});
