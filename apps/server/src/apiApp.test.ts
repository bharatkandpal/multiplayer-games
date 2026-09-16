import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServerlessApiApp } from "./apiApp.js";

/**
 * The container may run storage-less (offline play is inviolable), but the
 * serverless half may not: in-memory `Map`s die with the function instance, so
 * a missing DATABASE_URL there means every write appears to succeed and then
 * vanishes. It has to fail loudly instead.
 */
describe("createServerlessApiApp — DATABASE_URL guard", () => {
  const original = process.env["DATABASE_URL"];

  beforeEach(() => {
    delete process.env["DATABASE_URL"];
  });

  afterEach(() => {
    if (original === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = original;
  });

  it("refuses to build the app when DATABASE_URL is absent", async () => {
    await expect(createServerlessApiApp()).rejects.toThrow(/DATABASE_URL is required/);
  });

  it("names the fix in the message, rather than just the symptom", async () => {
    await expect(createServerlessApiApp()).rejects.toThrow(/\.env\.example/);
  });

  it("treats an empty DATABASE_URL as absent", async () => {
    process.env["DATABASE_URL"] = "";
    await expect(createServerlessApiApp()).rejects.toThrow(/DATABASE_URL is required/);
  });
});
