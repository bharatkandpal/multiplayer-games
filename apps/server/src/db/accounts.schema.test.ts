/**
 * Schema-level tests for the accounts tables (CRTR-001b, ADR 0012).
 *
 * These assert database constraints, so they need a real Postgres: they run only
 * when `DATABASE_URL` is set (same opt-in as the store contract suite) and are
 * skipped otherwise. They clean up the rows they create, but still point them at
 * a scratch database. Apply migrations first (`pnpm --filter @mpg/server db:migrate`).
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Sql } from "./connection.js";
import type { Database } from "./drizzle.js";
import { account, creatorRequest, sessions } from "./schema.js";

const enabled = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!enabled)("accounts schema (postgres)", () => {
  let pgSql: Sql;
  let db: Database;

  beforeEach(async () => {
    if (!db) {
      const { createSql } = await import("./connection.js");
      const { createDatabase } = await import("./drizzle.js");
      pgSql = createSql();
      db = createDatabase(pgSql);
    }
    await db.execute(sql`TRUNCATE TABLE account, sessions CASCADE`);
  });

  afterAll(async () => {
    await pgSql?.end();
  });

  async function mkAccount(email: string) {
    const [row] = await db.insert(account).values({ email, passwordHash: "h" }).returning();
    return row!;
  }

  it("applies defaults: role=user, email_verified=false", async () => {
    const a = await mkAccount("a@example.com");
    expect(a.role).toBe("user");
    expect(a.emailVerified).toBe(false);
  });

  it("email is unique case-insensitively (citext)", async () => {
    await mkAccount("Dup@Example.com");
    await expect(mkAccount("dup@example.COM")).rejects.toThrow();
  });

  it("allows only one pending creator_request per account", async () => {
    const a = await mkAccount("a@example.com");
    await db.insert(creatorRequest).values({ accountId: a.id });
    await expect(db.insert(creatorRequest).values({ accountId: a.id })).rejects.toThrow();
  });

  it("allows a new pending request once the previous one is decided", async () => {
    const a = await mkAccount("a@example.com");
    const [first] = await db.insert(creatorRequest).values({ accountId: a.id }).returning();
    await db
      .update(creatorRequest)
      .set({ status: "declined", decidedAt: new Date() })
      .where(eq(creatorRequest.id, first!.id));
    await db.insert(creatorRequest).values({ accountId: a.id });
    // Decided history is unbounded.
    await db.insert(creatorRequest).values({ accountId: a.id, status: "declined" });
    await db.insert(creatorRequest).values({ accountId: a.id, status: "declined" });
    const rows = await db.select().from(creatorRequest).where(eq(creatorRequest.accountId, a.id));
    expect(rows).toHaveLength(4);
  });

  it("pending uniqueness is per account", async () => {
    const a = await mkAccount("a@example.com");
    const b = await mkAccount("b@example.com");
    await db.insert(creatorRequest).values({ accountId: a.id });
    await db.insert(creatorRequest).values({ accountId: b.id });
  });

  it("deleting an account sets sessions.account_id to null (session survives)", async () => {
    const a = await mkAccount("a@example.com");
    await db.insert(sessions).values({ token: "tok-1", accountId: a.id });
    await db.delete(account).where(eq(account.id, a.id));
    const [s] = await db.select().from(sessions).where(eq(sessions.token, "tok-1"));
    expect(s).toBeDefined();
    expect(s!.accountId).toBeNull();
  });

  it("deleting an account cascades its creator requests", async () => {
    const a = await mkAccount("a@example.com");
    await db.insert(creatorRequest).values({ accountId: a.id });
    await db.delete(account).where(eq(account.id, a.id));
    expect(await db.select().from(creatorRequest)).toHaveLength(0);
  });
});
