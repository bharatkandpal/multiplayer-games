/**
 * The storage-less guard, at the function seam (MPG-135).
 *
 * `@mpg/server` tests that `createServerlessApiApp` throws without a
 * `DATABASE_URL`; what matters *here* is that the deployed function surfaces
 * that throw instead of booting on the in-memory store. A function instance's
 * Maps die with the instance, so a silently memory-backed deployment would 200
 * every write and lose it — worse than a dead deploy (see CLAUDE.md: the
 * offline rule protects local play, not a phantom production database).
 *
 * This file imports the real `@mpg/server/app`, so it needs no mock — and
 * deliberately runs with `DATABASE_URL` unset, which is also how CI runs.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

const original = process.env["DATABASE_URL"];

beforeEach(() => {
  delete process.env["DATABASE_URL"];
  vi.resetModules();
});

afterEach(() => {
  if (original === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = original;
});

async function loadHandler(): Promise<Handler> {
  const mod = (await import("../api/[...path].js")) as { default: Handler };
  return mod.default;
}

describe("catch-all function — no DATABASE_URL", () => {
  it("fails the invocation rather than serving from memory", async () => {
    const handler = await loadHandler();

    await expect(
      handler({ url: "/api/health" } as VercelRequest, {} as VercelResponse),
    ).rejects.toThrow(/DATABASE_URL is required/);
  });

  it("keeps failing on every invocation of the same instance", async () => {
    // The memoized promise is a rejected one, and stays rejected: a warm
    // instance's environment cannot change, so retrying would only mask the
    // misconfiguration behind an intermittent-looking 500.
    const handler = await loadHandler();

    await expect(handler({} as VercelRequest, {} as VercelResponse)).rejects.toThrow(
      /DATABASE_URL is required/,
    );
    await expect(handler({} as VercelRequest, {} as VercelResponse)).rejects.toThrow(
      /DATABASE_URL is required/,
    );
  });
});
