import type { Server } from "node:http";

import express, {
  type NextFunction,
  type Request as ExRequest,
  type Response as ExResponse,
} from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RateLimitFor } from "../../middleware/rateLimit.js";
import { createMemoryStore } from "../../store/memory/index.js";
import type { Store } from "../../store/ports.js";
import { SESSION_HEADER, createSessionMiddleware } from "../../sessions/sessionMiddleware.js";
import { createReportRouter } from "../reportRoutes.js";

describe("report routes", () => {
  let store: Store;
  let server: Server;
  let baseUrl: string;

  async function listen(limit?: RateLimitFor): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use(createSessionMiddleware(store));
    app.use("/api", createReportRouter(store, limit));

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a network address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  beforeEach(() => {
    store = createMemoryStore();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function report(token: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/report`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: token },
      body: JSON.stringify(body),
    });
  }

  it("files a report and persists it owner-scoped (201)", async () => {
    await listen();
    const res = await report("sess-a", {
      kind: "handle",
      targetId: "identity-42",
      reason: "impersonating a mod",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });

    const filed = await store.reports.findByReporter("sess-a");
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      kind: "handle",
      targetId: "identity-42",
      reason: "impersonating a mod",
      reporterToken: "sess-a",
    });
  });

  it("accepts a report with no reason and stores null", async () => {
    await listen();
    const res = await report("sess-a", { kind: "username", targetId: "session-7" });
    expect(res.status).toBe(201);
    const [filed] = await store.reports.findByReporter("sess-a");
    expect(filed!.reason).toBeNull();
  });

  it("treats a whitespace-only reason as no reason", async () => {
    await listen();
    await report("sess-a", { kind: "username", targetId: "session-7", reason: "   " });
    const [filed] = await store.reports.findByReporter("sess-a");
    expect(filed!.reason).toBeNull();
  });

  it("rejects an unknown kind (400 INVALID_REPORT), never 5xx", async () => {
    await listen();
    const res = await report("sess-a", { kind: "avatar", targetId: "x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_REPORT", reason: "kind" });
    expect(await store.reports.findByReporter("sess-a")).toHaveLength(0);
  });

  it("rejects a missing or empty targetId (400)", async () => {
    await listen();
    expect((await report("sess-a", { kind: "handle" })).status).toBe(400);
    const res = await report("sess-a", { kind: "handle", targetId: "" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_REPORT", reason: "targetId" });
  });

  it("rejects an over-long targetId (400)", async () => {
    await listen();
    const res = await report("sess-a", { kind: "handle", targetId: "x".repeat(65) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_REPORT", reason: "targetId" });
  });

  it("rejects an over-long reason (400)", async () => {
    await listen();
    const res = await report("sess-a", {
      kind: "handle",
      targetId: "identity-42",
      reason: "x".repeat(281),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_REPORT", reason: "reason" });
  });

  it("enforces the report_name rate policy", async () => {
    // A limiter that throttles exactly the report_name policy proves the route
    // is wired to it — the concrete numeric limit is deploy-time config.
    const throttleReportName: RateLimitFor =
      (policy: string) => (_req: ExRequest, res: ExResponse, next: NextFunction) => {
        if (policy === "report_name") {
          res.status(429).json({ code: "RATE_LIMITED" });
          return;
        }
        next();
      };
    await listen(throttleReportName);

    const res = await report("sess-a", { kind: "handle", targetId: "identity-42" });
    expect(res.status).toBe(429);
    expect(await store.reports.findByReporter("sess-a")).toHaveLength(0);
  });
});
