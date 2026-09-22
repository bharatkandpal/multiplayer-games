/**
 * Contract tests for the Store interface.
 *
 * Runs against the in-memory adapter (always) so Vitest needs zero external
 * deps. **Set `DATABASE_URL` and the identical suite also runs against the
 * Postgres adapter** (MPG-133) — same assertions, both sides of the seam, which
 * is the only way "the repos are interchangeable" stops being a claim and
 * becomes a test. Without it the suite is silently memory-only.
 *
 *   docker compose up -d
 *   pnpm --filter @mpg/server db:migrate   # once, with DATABASE_URL set
 *   DATABASE_URL=postgres://mpg:mpg_local@localhost:5432/mpg_dev \
 *     pnpm --filter @mpg/server test
 *
 * The Postgres run is destructive — it truncates every table before each test —
 * so point it at a scratch database, never at anything you care about.
 */

import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import type { Database } from "../../db/drizzle.js";
import type { Sql } from "../../db/connection.js";
import type { Store } from "../ports.js";
import { createMemoryStore } from "../memory/index.js";

/**
 * Every table the store owns. Truncated as one statement so FK order doesn't
 * matter; `RESTART IDENTITY` keeps serial columns from leaking test to test.
 */
const STORE_TABLES = [
  "sessions",
  "identities",
  "game_results",
  "leaderboard_entries",
  "share_links",
  "analytics_events",
  "reports",
  "variants",
  "chat_messages",
] as const;

type Adapter = readonly [name: string, setup: () => Promise<Store>];

/**
 * The container's driver (postgres.js), built here rather than through
 * `createDatabaseFromEnv` so the suite owns the connection handle and can close
 * it in `afterAll` — an open pool outlives the run and hangs Vitest. Driver
 * *selection* is a separate concern with its own unit coverage; what this suite
 * is for is the repos.
 */
let pgSql: Sql | undefined;
let pgDb: Database | undefined;
let pgStore: Store | undefined;

async function setupPostgresStore(): Promise<Store> {
  if (!pgStore || !pgDb) {
    const { createSql } = await import("../../db/connection.js");
    const { createDatabase } = await import("../../db/drizzle.js");
    const { createPgStore } = await import("../pg/index.js");
    pgSql = createSql();
    pgDb = createDatabase(pgSql);
    pgStore = createPgStore(pgDb);
  }
  // The memory adapter gets a fresh instance per test; Postgres gets the
  // equivalent — an empty database — so the assertions can be identical.
  await pgDb.execute(sql.raw(`TRUNCATE TABLE ${STORE_TABLES.join(", ")} RESTART IDENTITY CASCADE`));
  return pgStore;
}

const adapters: Adapter[] = [["memory", async () => createMemoryStore()]];
if (process.env["DATABASE_URL"]) {
  adapters.push(["postgres", setupPostgresStore]);
}

afterAll(async () => {
  await pgSql?.end();
});

describe.each(adapters)("%s adapter", (_name, factory) => {
  let store: Store;

  beforeEach(async () => {
    store = await factory();
  });

  // -----------------------------------------------------------------------
  // SessionRepo
  // -----------------------------------------------------------------------

  describe("SessionRepo", () => {
    it("upserts a session and retrieves it by token", async () => {
      const session = await store.sessions.upsert("tok-1");
      expect(session.token).toBe("tok-1");
      expect(session.id).toBeTruthy();

      const found = await store.sessions.findByToken("tok-1");
      expect(found).toEqual(session);
    });

    it("upsert is idempotent — returns same session for same token", async () => {
      const s1 = await store.sessions.upsert("tok-1");
      const s2 = await store.sessions.upsert("tok-1");
      expect(s2.id).toBe(s1.id);
    });

    it("touch updates lastSeenAt", async () => {
      const s1 = await store.sessions.upsert("tok-1");
      const before = s1.lastSeenAt.getTime();

      // Small delay so timestamp differs
      await new Promise((r) => setTimeout(r, 10));
      await store.sessions.touch("tok-1");

      const s2 = await store.sessions.findByToken("tok-1");
      expect(s2!.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("delete removes the session", async () => {
      await store.sessions.upsert("tok-1");
      const deleted = await store.sessions.delete("tok-1");
      expect(deleted).toBe(true);
      expect(await store.sessions.findByToken("tok-1")).toBeUndefined();
    });

    it("delete returns false for unknown token", async () => {
      const deleted = await store.sessions.delete("nonexistent");
      expect(deleted).toBe(false);
    });

    it("findByToken returns undefined for unknown", async () => {
      expect(await store.sessions.findByToken("nope")).toBeUndefined();
    });

    it("username defaults to null", async () => {
      const session = await store.sessions.upsert("tok-1");
      expect(session.username).toBeNull();
    });

    it("setUsername claims a username", async () => {
      await store.sessions.upsert("tok-1");
      const result = await store.sessions.setUsername("tok-1", "Alice");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.session.username).toBe("Alice");
      }

      const found = await store.sessions.findByToken("tok-1");
      expect(found!.username).toBe("Alice");
    });

    it("setUsername rejects a case-insensitive duplicate", async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.upsert("tok-2");
      await store.sessions.setUsername("tok-1", "Alice");

      const result = await store.sessions.setUsername("tok-2", "alice");
      expect(result).toEqual({ ok: false, reason: "taken" });

      const found = await store.sessions.findByToken("tok-2");
      expect(found!.username).toBeNull();
    });

    it("setUsername is idempotent for the caller's own name (any casing)", async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.setUsername("tok-1", "Alice");

      const result = await store.sessions.setUsername("tok-1", "alice");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.session.username).toBe("alice");
      }
    });

    it("setUsername lets a different session take a freed-up name after rename", async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.upsert("tok-2");
      await store.sessions.setUsername("tok-1", "Alice");
      await store.sessions.setUsername("tok-1", "Alicia");

      const result = await store.sessions.setUsername("tok-2", "Alice");
      expect(result.ok).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // IdentityRepo (MPG-091)
  // -----------------------------------------------------------------------

  describe("IdentityRepo", () => {
    const HASH_A = "a".repeat(64);
    const HASH_B = "b".repeat(64);

    it("claims a handle and links the calling session", async () => {
      await store.sessions.upsert("tok-1");
      const result = await store.identities.claim("tok-1", "Nova", HASH_A);
      expect(result.ok).toBe(true);

      const identity = await store.identities.findByToken("tok-1");
      expect(identity?.handle).toBe("Nova");
      expect(identity?.id).toBeTruthy();
    });

    it("findByToken returns undefined for an unclaimed session", async () => {
      await store.sessions.upsert("tok-1");
      expect(await store.identities.findByToken("tok-1")).toBeUndefined();
    });

    it("rejects a second claim from the same session (already_claimed)", async () => {
      await store.sessions.upsert("tok-1");
      await store.identities.claim("tok-1", "Nova", HASH_A);
      const again = await store.identities.claim("tok-1", "Other", HASH_B);
      expect(again).toEqual({ ok: false, reason: "already_claimed" });
    });

    it("rejects a handle already taken (case-insensitive)", async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.upsert("tok-2");
      await store.identities.claim("tok-1", "Nova", HASH_A);
      const taken = await store.identities.claim("tok-2", "nova", HASH_B);
      expect(taken).toEqual({ ok: false, reason: "handle_taken" });
    });

    it("adopts an existing identity onto a new session by recovery hash", async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.upsert("tok-2");
      const claim = await store.identities.claim("tok-1", "Nova", HASH_A);
      const claimedId = claim.ok ? claim.identity.id : "";

      const adopt = await store.identities.adopt("tok-2", HASH_A);
      expect(adopt.ok).toBe(true);
      if (adopt.ok) expect(adopt.identity.id).toBe(claimedId);

      const fromNewDevice = await store.identities.findByToken("tok-2");
      expect(fromNewDevice?.id).toBe(claimedId);
    });

    it("rejects adoption with an unknown recovery hash", async () => {
      await store.sessions.upsert("tok-2");
      const adopt = await store.identities.adopt("tok-2", HASH_B);
      expect(adopt).toEqual({ ok: false, reason: "invalid_code" });
    });

    it("tokensForIdentity returns every linked session (claim + adopt)", async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.upsert("tok-2");
      const claim = await store.identities.claim("tok-1", "Nova", HASH_A);
      const id = claim.ok ? claim.identity.id : "";
      await store.identities.adopt("tok-2", HASH_A);

      const tokens = await store.identities.tokensForIdentity(id);
      expect(tokens.sort()).toEqual(["tok-1", "tok-2"]);
    });
  });

  // -----------------------------------------------------------------------
  // ResultRepo
  // -----------------------------------------------------------------------

  describe("ResultRepo", () => {
    const makeResult = (overrides?: Record<string, unknown>) => ({
      runId: `run-${crypto.randomUUID()}`,
      gameId: "tictactoe",
      ownerToken: "tok-1",
      status: "win",
      seatsSnapshot: [{ kind: "human" }, { kind: "bot", difficulty: "easy" }],
      ...overrides,
    });

    beforeEach(async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.upsert("tok-2");
    });

    it("saves and retrieves by runId", async () => {
      const input = makeResult({ runId: "run-1" });
      const saved = await store.results.save(input);
      expect(saved.runId).toBe("run-1");
      expect(saved.gameId).toBe("tictactoe");
      expect(saved.id).toBeTruthy();

      const found = await store.results.findByRunId("run-1");
      expect(found).toEqual(saved);
    });

    it("findById resolves by primary key — the key share links point at", async () => {
      const saved = await store.results.save(makeResult({ runId: "run-by-id" }));

      expect(await store.results.findById(saved.id)).toEqual(saved);
      expect(await store.results.findById(crypto.randomUUID())).toBeUndefined();
    });

    it("save is idempotent on runId", async () => {
      const input = makeResult({ runId: "dup-1" });
      const first = await store.results.save(input);
      const second = await store.results.save(input);
      expect(second.id).toBe(first.id);
    });

    it("findByOwner returns newest first", async () => {
      await store.results.save(makeResult({ runId: "r1", ownerToken: "tok-1" }));
      await new Promise((r) => setTimeout(r, 5));
      await store.results.save(makeResult({ runId: "r2", ownerToken: "tok-1" }));

      const results = await store.results.findByOwner("tok-1");
      expect(results).toHaveLength(2);
      expect(results[0]!.runId).toBe("r2");
      expect(results[1]!.runId).toBe("r1");
    });

    it("findByOwner respects pagination", async () => {
      await store.results.save(makeResult({ runId: "r1" }));
      await new Promise((r) => setTimeout(r, 5));
      await store.results.save(makeResult({ runId: "r2" }));
      await new Promise((r) => setTimeout(r, 5));
      await store.results.save(makeResult({ runId: "r3" }));

      const page = await store.results.findByOwner("tok-1", {
        limit: 2,
        offset: 0,
      });
      expect(page).toHaveLength(2);
    });

    it("findByOwners unions results across tokens, newest first (MPG-091-b)", async () => {
      await store.results.save(makeResult({ runId: "r1", ownerToken: "tok-1" }));
      await new Promise((r) => setTimeout(r, 5));
      await store.results.save(makeResult({ runId: "r2", ownerToken: "tok-2" }));
      await new Promise((r) => setTimeout(r, 5));
      await store.results.save(makeResult({ runId: "r3", ownerToken: "tok-1" }));

      const union = await store.results.findByOwners(["tok-1", "tok-2"]);
      expect(union.map((r) => r.runId)).toEqual(["r3", "r2", "r1"]);

      // A single-token set is exactly the old single-owner behaviour.
      const onlyOne = await store.results.findByOwners(["tok-2"]);
      expect(onlyOne.map((r) => r.runId)).toEqual(["r2"]);
    });

    it("findByOwners returns [] for an empty token set", async () => {
      await store.results.save(makeResult({ runId: "r1", ownerToken: "tok-1" }));
      expect(await store.results.findByOwners([])).toEqual([]);
    });

    it("findByOwners paginates across the union", async () => {
      await store.results.save(makeResult({ runId: "r1", ownerToken: "tok-1" }));
      await new Promise((r) => setTimeout(r, 5));
      await store.results.save(makeResult({ runId: "r2", ownerToken: "tok-2" }));
      await new Promise((r) => setTimeout(r, 5));
      await store.results.save(makeResult({ runId: "r3", ownerToken: "tok-1" }));

      const page = await store.results.findByOwners(["tok-1", "tok-2"], { limit: 2, offset: 1 });
      expect(page.map((r) => r.runId)).toEqual(["r2", "r1"]);
    });

    it("findByGameAndEvent filters correctly", async () => {
      await store.results.save(makeResult({ runId: "r1", gameId: "tictactoe", eventId: "evt-A" }));
      await store.results.save(makeResult({ runId: "r2", gameId: "tictactoe", eventId: "evt-B" }));
      await store.results.save(makeResult({ runId: "r3", gameId: "connect4" }));

      const tttA = await store.results.findByGameAndEvent("tictactoe", "evt-A");
      expect(tttA).toHaveLength(1);
      expect(tttA[0]!.eventId).toBe("evt-A");

      const allTtt = await store.results.findByGameAndEvent("tictactoe");
      expect(allTtt).toHaveLength(2);
    });

    it("deleteByOwner removes all owner's results", async () => {
      await store.results.save(makeResult({ runId: "r1", ownerToken: "tok-1" }));
      await store.results.save(makeResult({ runId: "r2", ownerToken: "tok-1" }));
      await store.results.save(makeResult({ runId: "r3", ownerToken: "tok-2" }));

      const count = await store.results.deleteByOwner("tok-1");
      expect(count).toBe(2);
      expect(await store.results.findByOwner("tok-1")).toHaveLength(0);
      expect(await store.results.findByOwner("tok-2")).toHaveLength(1);
    });

    it("deleteOlderThan removes old results", async () => {
      await store.results.save(makeResult({ runId: "old" }));
      const cutoff = new Date(Date.now() + 1000); // everything is "old"
      const count = await store.results.deleteOlderThan(cutoff);
      expect(count).toBe(1);
    });

    it("defaults gameFamily to turn-based", async () => {
      const saved = await store.results.save(makeResult({ runId: "r1" }));
      expect(saved.gameFamily).toBe("turn-based");
    });

    it("stores realtime game family", async () => {
      const saved = await store.results.save(
        makeResult({ runId: "r1", gameFamily: "realtime", gameId: "floppy-birds", score: 42 }),
      );
      expect(saved.gameFamily).toBe("realtime");
      expect(saved.score).toBe(42);
    });
  });

  // -----------------------------------------------------------------------
  // LeaderboardRepo
  // -----------------------------------------------------------------------

  describe("LeaderboardRepo", () => {
    beforeEach(async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.upsert("tok-2");
      await store.sessions.upsert("tok-3");
    });

    it("upserts and accumulates wins", async () => {
      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        ownerToken: "tok-1",
        wins: 1,
        totalGames: 1,
      });
      const entry = await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        ownerToken: "tok-1",
        wins: 1,
        totalGames: 1,
      });
      expect(entry.wins).toBe(2);
      expect(entry.totalGames).toBe(2);
    });

    it("upserts bestScore as max", async () => {
      await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: "tok-1",
        bestScore: 50,
        totalGames: 1,
      });
      const entry = await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: "tok-1",
        bestScore: 30,
        totalGames: 1,
      });
      expect(entry.bestScore).toBe(50); // max, not replaced
    });

    it("topN returns sorted by bestScore DESC for score metric", async () => {
      await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: "tok-1",
        bestScore: 30,
        totalGames: 1,
      });
      await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: "tok-2",
        bestScore: 80,
        totalGames: 1,
      });
      await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: "tok-3",
        bestScore: 55,
        totalGames: 1,
      });

      const top = await store.leaderboard.topN("floppy-birds", "score", 2);
      expect(top).toHaveLength(2);
      expect(top[0]!.ownerToken).toBe("tok-2"); // 80
      expect(top[1]!.ownerToken).toBe("tok-3"); // 55
    });

    it("topN returns sorted by wins DESC for wld metric", async () => {
      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        ownerToken: "tok-1",
        wins: 5,
        totalGames: 8,
      });
      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        ownerToken: "tok-2",
        wins: 10,
        totalGames: 12,
      });

      const top = await store.leaderboard.topN("tictactoe", "wld", 5);
      expect(top[0]!.ownerToken).toBe("tok-2");
    });

    it("rankOf returns 1-based position", async () => {
      await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: "tok-1",
        bestScore: 100,
        totalGames: 1,
      });
      await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: "tok-2",
        bestScore: 50,
        totalGames: 1,
      });

      expect(await store.leaderboard.rankOf("floppy-birds", "score", "tok-1")).toBe(1);
      expect(await store.leaderboard.rankOf("floppy-birds", "score", "tok-2")).toBe(2);
      expect(await store.leaderboard.rankOf("floppy-birds", "score", "tok-3")).toBeUndefined();
    });

    it("rankOfBest returns the best rank across a token set (MPG-091-b)", async () => {
      await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: "tok-1",
        bestScore: 100,
        totalGames: 1,
      });
      await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: "tok-2",
        bestScore: 70,
        totalGames: 1,
      });
      await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: "tok-3",
        bestScore: 40,
        totalGames: 1,
      });

      // tok-2 and tok-3 belong to the same player: their best rank is tok-2's (2nd).
      expect(await store.leaderboard.rankOfBest("floppy-birds", "score", ["tok-2", "tok-3"])).toBe(
        2,
      );
      // Union with the top entry surfaces rank 1.
      expect(await store.leaderboard.rankOfBest("floppy-birds", "score", ["tok-1", "tok-3"])).toBe(
        1,
      );
      // A single-token set matches the old rankOf.
      expect(await store.leaderboard.rankOfBest("floppy-birds", "score", ["tok-3"])).toBe(3);
    });

    it("rankOfBest is undefined when no token is on the board (and for an empty set)", async () => {
      await store.leaderboard.upsert({
        gameId: "floppy-birds",
        metric: "score",
        ownerToken: "tok-1",
        bestScore: 100,
        totalGames: 1,
      });
      expect(
        await store.leaderboard.rankOfBest("floppy-birds", "score", ["tok-2", "tok-3"]),
      ).toBeUndefined();
      expect(await store.leaderboard.rankOfBest("floppy-birds", "score", [])).toBeUndefined();
    });

    it("filters by eventId", async () => {
      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        eventId: "evt-A",
        ownerToken: "tok-1",
        wins: 3,
        totalGames: 3,
      });
      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        eventId: "evt-B",
        ownerToken: "tok-2",
        wins: 5,
        totalGames: 5,
      });

      const top = await store.leaderboard.topN("tictactoe", "wld", 10, {
        eventId: "evt-A",
      });
      expect(top).toHaveLength(1);
      expect(top[0]!.ownerToken).toBe("tok-1");
    });

    it("deleteByOwner removes all entries", async () => {
      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        ownerToken: "tok-1",
        wins: 1,
        totalGames: 1,
      });
      const count = await store.leaderboard.deleteByOwner("tok-1");
      expect(count).toBe(1);
    });

    it("deleteByEvent removes event entries", async () => {
      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        eventId: "evt-X",
        ownerToken: "tok-1",
        wins: 1,
        totalGames: 1,
      });
      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        ownerToken: "tok-2",
        wins: 1,
        totalGames: 1,
      });
      const count = await store.leaderboard.deleteByEvent("evt-X");
      expect(count).toBe(1);
      // Global entry untouched
      const top = await store.leaderboard.topN("tictactoe", "wld", 10);
      expect(top).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // ShareLinkRepo
  // -----------------------------------------------------------------------

  describe("ShareLinkRepo", () => {
    beforeEach(async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.upsert("tok-2");
    });

    it("creates and retrieves a share link", async () => {
      const link = await store.shareLinks.create({
        token: "sl-1",
        kind: "result",
        targetId: crypto.randomUUID(),
        ownerToken: "tok-1",
      });
      expect(link.token).toBe("sl-1");
      expect(link.revoked).toBe(false);

      const found = await store.shareLinks.findByToken("sl-1");
      expect(found).toEqual(link);
    });

    it("findByToken returns undefined for revoked links", async () => {
      await store.shareLinks.create({
        token: "sl-1",
        kind: "result",
        targetId: crypto.randomUUID(),
        ownerToken: "tok-1",
      });
      await store.shareLinks.revoke("sl-1", "tok-1");

      expect(await store.shareLinks.findByToken("sl-1")).toBeUndefined();
    });

    it("findByToken returns undefined for expired links", async () => {
      await store.shareLinks.create({
        token: "sl-1",
        kind: "result",
        targetId: crypto.randomUUID(),
        ownerToken: "tok-1",
        expiresAt: new Date(Date.now() - 1000), // already expired
      });

      expect(await store.shareLinks.findByToken("sl-1")).toBeUndefined();
    });

    it("revoke only works for the owner", async () => {
      await store.shareLinks.create({
        token: "sl-1",
        kind: "result",
        targetId: crypto.randomUUID(),
        ownerToken: "tok-1",
      });

      expect(await store.shareLinks.revoke("sl-1", "tok-2")).toBe(false);
      expect(await store.shareLinks.findByToken("sl-1")).toBeTruthy();

      expect(await store.shareLinks.revoke("sl-1", "tok-1")).toBe(true);
      expect(await store.shareLinks.findByToken("sl-1")).toBeUndefined();
    });

    it("deleteByOwner removes all owner's links", async () => {
      await store.shareLinks.create({
        token: "sl-1",
        kind: "result",
        targetId: crypto.randomUUID(),
        ownerToken: "tok-1",
      });
      await store.shareLinks.create({
        token: "sl-2",
        kind: "replay",
        targetId: crypto.randomUUID(),
        ownerToken: "tok-1",
      });

      const count = await store.shareLinks.deleteByOwner("tok-1");
      expect(count).toBe(2);
    });

    it("deleteExpired removes only expired links", async () => {
      await store.shareLinks.create({
        token: "sl-expired",
        kind: "result",
        targetId: crypto.randomUUID(),
        ownerToken: "tok-1",
        expiresAt: new Date(Date.now() - 1000),
      });
      await store.shareLinks.create({
        token: "sl-valid",
        kind: "result",
        targetId: crypto.randomUUID(),
        ownerToken: "tok-1",
        expiresAt: new Date(Date.now() + 100_000),
      });

      const count = await store.shareLinks.deleteExpired();
      expect(count).toBe(1);
      expect(await store.shareLinks.findByToken("sl-valid")).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // ReportRepo (MPG-092 slice 2)
  // -----------------------------------------------------------------------

  describe("ReportRepo", () => {
    beforeEach(async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.upsert("tok-2");
    });

    it("creates a report and finds it by reporter", async () => {
      const created = await store.reports.create({
        kind: "handle",
        targetId: "identity-42",
        reason: "impersonation",
        reporterToken: "tok-1",
      });

      expect(created.id).toBeTruthy();
      expect(created.kind).toBe("handle");
      expect(created.targetId).toBe("identity-42");
      expect(created.reason).toBe("impersonation");
      expect(created.reporterToken).toBe("tok-1");

      const found = await store.reports.findByReporter("tok-1");
      expect(found).toEqual([created]);
    });

    it("defaults an omitted reason to null", async () => {
      const created = await store.reports.create({
        kind: "username",
        targetId: "session-7",
        reporterToken: "tok-1",
      });
      expect(created.reason).toBeNull();
    });

    it("findByReporter returns newest first", async () => {
      await store.reports.create({ kind: "username", targetId: "a", reporterToken: "tok-1" });
      await new Promise((r) => setTimeout(r, 5));
      await store.reports.create({ kind: "username", targetId: "b", reporterToken: "tok-1" });

      const found = await store.reports.findByReporter("tok-1");
      expect(found.map((r) => r.targetId)).toEqual(["b", "a"]);
    });

    it("findByReporter scopes to the reporter and returns [] for none", async () => {
      await store.reports.create({ kind: "username", targetId: "a", reporterToken: "tok-1" });
      expect(await store.reports.findByReporter("tok-2")).toEqual([]);
    });

    it("findByReporter paginates with limit + offset", async () => {
      for (const targetId of ["a", "b", "c"]) {
        await store.reports.create({ kind: "username", targetId, reporterToken: "tok-1" });
        await new Promise((r) => setTimeout(r, 5));
      }
      // Newest-first is [c, b, a]; offset 1 + limit 1 → [b].
      const page = await store.reports.findByReporter("tok-1", { limit: 1, offset: 1 });
      expect(page.map((r) => r.targetId)).toEqual(["b"]);
    });

    it("deleteByOwner removes all of a reporter's reports", async () => {
      await store.reports.create({ kind: "username", targetId: "a", reporterToken: "tok-1" });
      await store.reports.create({ kind: "handle", targetId: "b", reporterToken: "tok-1" });
      await store.reports.create({ kind: "username", targetId: "c", reporterToken: "tok-2" });

      const count = await store.reports.deleteByOwner("tok-1");
      expect(count).toBe(2);
      expect(await store.reports.findByReporter("tok-1")).toEqual([]);
      expect(await store.reports.findByReporter("tok-2")).toHaveLength(1);
    });

    it("deleteOlderThan removes only reports before the cutoff", async () => {
      await store.reports.create({ kind: "username", targetId: "a", reporterToken: "tok-1" });
      // Everything just created is newer than a past cutoff, so nothing is swept.
      const past = new Date(Date.now() - 60_000);
      expect(await store.reports.deleteOlderThan(past)).toBe(0);
      // A future cutoff is after every row, so all are swept.
      const future = new Date(Date.now() + 60_000);
      expect(await store.reports.deleteOlderThan(future)).toBe(1);
      expect(await store.reports.findByReporter("tok-1")).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // VariantRepo (MPG-089)
  // -----------------------------------------------------------------------

  describe("VariantRepo", () => {
    beforeEach(async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.upsert("tok-2");
    });

    it("creates a variant and finds it by id", async () => {
      const created = await store.variants.create({
        name: "Neon Nim",
        ownerToken: "tok-1",
        baseGameId: "nim",
        cosmetics: { theme: "neon", piece: "orb" },
      });

      expect(created.id).toBeTruthy();
      expect(created.name).toBe("Neon Nim");
      expect(created.ownerToken).toBe("tok-1");
      expect(created.baseGameId).toBe("nim");
      expect(created.cosmetics).toEqual({ theme: "neon", piece: "orb" });
      expect(created.forkedFrom).toBeNull();

      const found = await store.variants.findById(created.id);
      expect(found).toEqual(created);
    });

    it("findById returns undefined for an unknown id", async () => {
      expect(await store.variants.findById(crypto.randomUUID())).toBeUndefined();
    });

    it("defaults forkedFrom to null and preserves it when set", async () => {
      const parent = await store.variants.create({
        name: "Base",
        ownerToken: "tok-1",
        baseGameId: "nim",
        cosmetics: {},
      });
      expect(parent.forkedFrom).toBeNull();

      const child = await store.variants.create({
        name: "Fork",
        ownerToken: "tok-1",
        baseGameId: "nim",
        cosmetics: { theme: "dark" },
        forkedFrom: parent.id,
      });
      expect(child.forkedFrom).toBe(parent.id);
    });

    it("stores an empty cosmetics map (defaults, saved and named)", async () => {
      const created = await store.variants.create({
        name: "Just The Name",
        ownerToken: "tok-1",
        baseGameId: "nim",
        cosmetics: {},
      });
      expect(created.cosmetics).toEqual({});
    });

    it("does not alias stored cosmetics to the input object", async () => {
      const cosmetics: Record<string, string> = { theme: "neon" };
      const created = await store.variants.create({
        name: "Isolated",
        ownerToken: "tok-1",
        baseGameId: "nim",
        cosmetics,
      });
      // Mutating the caller's object must not change what was stored.
      cosmetics["theme"] = "tampered";
      const found = await store.variants.findById(created.id);
      expect(found!.cosmetics).toEqual({ theme: "neon" });
    });

    it("findByOwner returns newest first", async () => {
      await store.variants.create({
        name: "v1",
        ownerToken: "tok-1",
        baseGameId: "nim",
        cosmetics: {},
      });
      await new Promise((r) => setTimeout(r, 5));
      await store.variants.create({
        name: "v2",
        ownerToken: "tok-1",
        baseGameId: "nim",
        cosmetics: {},
      });

      const owned = await store.variants.findByOwner("tok-1");
      expect(owned.map((v) => v.name)).toEqual(["v2", "v1"]);
    });

    it("findByOwner scopes to the owner and returns [] for none", async () => {
      await store.variants.create({
        name: "v1",
        ownerToken: "tok-1",
        baseGameId: "nim",
        cosmetics: {},
      });
      expect(await store.variants.findByOwner("tok-2")).toEqual([]);
    });

    it("findByOwner paginates with limit + offset", async () => {
      for (const name of ["a", "b", "c"]) {
        await store.variants.create({
          name,
          ownerToken: "tok-1",
          baseGameId: "nim",
          cosmetics: {},
        });
        await new Promise((r) => setTimeout(r, 5));
      }
      // Newest-first is [c, b, a]; offset 1 + limit 1 → [b].
      const page = await store.variants.findByOwner("tok-1", { limit: 1, offset: 1 });
      expect(page.map((v) => v.name)).toEqual(["b"]);
    });

    it("deleteByOwner removes all of an owner's variants", async () => {
      await store.variants.create({
        name: "a",
        ownerToken: "tok-1",
        baseGameId: "nim",
        cosmetics: {},
      });
      await store.variants.create({
        name: "b",
        ownerToken: "tok-1",
        baseGameId: "nim",
        cosmetics: {},
      });
      await store.variants.create({
        name: "c",
        ownerToken: "tok-2",
        baseGameId: "nim",
        cosmetics: {},
      });

      const count = await store.variants.deleteByOwner("tok-1");
      expect(count).toBe(2);
      expect(await store.variants.findByOwner("tok-1")).toEqual([]);
      expect(await store.variants.findByOwner("tok-2")).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // ChatMessageRepo (CHAT-021)
  // -----------------------------------------------------------------------

  describe("ChatMessageRepo", () => {
    beforeEach(async () => {
      await store.sessions.upsert("tok-1");
      await store.sessions.upsert("tok-2");
    });

    const makeMsg = (overrides: { id: string; ts: number } & Record<string, unknown>) => ({
      channel: "chat:room-1",
      roomId: "room-1",
      senderToken: "tok-1",
      senderName: "Ann",
      text: "hi",
      ...overrides,
    });

    it("appends a message and reads it back", async () => {
      await store.chat.append(makeMsg({ id: "m1", ts: 1000 }));
      const page = await store.chat.page("chat:room-1", { limit: 10 });
      expect(page).toHaveLength(1);
      expect(page[0]).toEqual({
        id: "m1",
        channel: "chat:room-1",
        roomId: "room-1",
        senderToken: "tok-1",
        senderName: "Ann",
        text: "hi",
        ts: 1000,
      });
    });

    it("append is idempotent on id", async () => {
      await store.chat.append(makeMsg({ id: "dup", ts: 1000, text: "first" }));
      await store.chat.append(makeMsg({ id: "dup", ts: 2000, text: "second" }));
      const page = await store.chat.page("chat:room-1", { limit: 10 });
      expect(page).toHaveLength(1);
      // The first write wins; the retried write is a no-op, not an overwrite.
      expect(page[0]!.text).toBe("first");
    });

    it("page returns newest-first and scopes to the channel", async () => {
      await store.chat.append(makeMsg({ id: "a", ts: 1000 }));
      await store.chat.append(makeMsg({ id: "b", ts: 2000 }));
      await store.chat.append(makeMsg({ id: "c", ts: 3000, channel: "chat:other" }));

      const page = await store.chat.page("chat:room-1", { limit: 10 });
      expect(page.map((m) => m.id)).toEqual(["b", "a"]);
    });

    it("page respects the limit", async () => {
      for (let i = 0; i < 5; i++) {
        await store.chat.append(makeMsg({ id: `m${i}`, ts: 1000 + i }));
      }
      const page = await store.chat.page("chat:room-1", { limit: 2 });
      expect(page).toHaveLength(2);
      expect(page.map((m) => m.id)).toEqual(["m4", "m3"]);
    });

    it("page returns only messages strictly older than the cursor", async () => {
      await store.chat.append(makeMsg({ id: "a", ts: 1000 }));
      await store.chat.append(makeMsg({ id: "b", ts: 2000 }));
      await store.chat.append(makeMsg({ id: "c", ts: 3000 }));

      // Older than c (ts 3000) → b then a; the cursor row itself is excluded.
      const older = await store.chat.page("chat:room-1", {
        before: { ts: 3000, id: "c" },
        limit: 10,
      });
      expect(older.map((m) => m.id)).toEqual(["b", "a"]);
    });

    it("breaks a same-ts cursor tie by id so paging never repeats or skips", async () => {
      // Three messages share a millisecond — the (ts, id) total order decides.
      await store.chat.append(makeMsg({ id: "id-a", ts: 5000 }));
      await store.chat.append(makeMsg({ id: "id-b", ts: 5000 }));
      await store.chat.append(makeMsg({ id: "id-c", ts: 5000 }));

      const first = await store.chat.page("chat:room-1", { limit: 2 });
      expect(first.map((m) => m.id)).toEqual(["id-c", "id-b"]);

      const oldestOfFirst = first[first.length - 1]!;
      const next = await store.chat.page("chat:room-1", {
        before: { ts: oldestOfFirst.ts, id: oldestOfFirst.id },
        limit: 2,
      });
      // Strictly older in the (ts, id) order → just id-a, no overlap.
      expect(next.map((m) => m.id)).toEqual(["id-a"]);
    });

    it("deleteByOwner removes all of a sender's messages", async () => {
      await store.chat.append(makeMsg({ id: "a", ts: 1000, senderToken: "tok-1" }));
      await store.chat.append(makeMsg({ id: "b", ts: 2000, senderToken: "tok-1" }));
      await store.chat.append(makeMsg({ id: "c", ts: 3000, senderToken: "tok-2" }));

      const count = await store.chat.deleteByOwner("tok-1");
      expect(count).toBe(2);
      const page = await store.chat.page("chat:room-1", { limit: 10 });
      expect(page.map((m) => m.id)).toEqual(["c"]);
    });

    it("deleteOlderThan removes only messages before the cutoff", async () => {
      await store.chat.append(makeMsg({ id: "old", ts: 1000 }));
      await store.chat.append(makeMsg({ id: "new", ts: Date.now() }));

      const count = await store.chat.deleteOlderThan(new Date(2000));
      expect(count).toBe(1);
      const page = await store.chat.page("chat:room-1", { limit: 10 });
      expect(page.map((m) => m.id)).toEqual(["new"]);
    });
  });

  // -----------------------------------------------------------------------
  // Retention / "Forget me"
  // -----------------------------------------------------------------------

  describe("Forget me (cross-repo)", () => {
    it("deletes all data for a session token", async () => {
      await store.sessions.upsert("tok-doomed");
      await store.sessions.upsert("tok-safe");

      await store.results.save({
        runId: "r1",
        gameId: "tictactoe",
        ownerToken: "tok-doomed",
        status: "win",
        seatsSnapshot: [],
      });
      await store.results.save({
        runId: "r2",
        gameId: "tictactoe",
        ownerToken: "tok-safe",
        status: "draw",
        seatsSnapshot: [],
      });

      await store.leaderboard.upsert({
        gameId: "tictactoe",
        metric: "wld",
        ownerToken: "tok-doomed",
        wins: 1,
        totalGames: 1,
      });

      await store.shareLinks.create({
        token: "sl-1",
        kind: "result",
        targetId: crypto.randomUUID(),
        ownerToken: "tok-doomed",
      });

      // Forget "tok-doomed"
      await store.results.deleteByOwner("tok-doomed");
      await store.leaderboard.deleteByOwner("tok-doomed");
      await store.shareLinks.deleteByOwner("tok-doomed");
      await store.sessions.delete("tok-doomed");

      // Doomed is gone
      expect(await store.sessions.findByToken("tok-doomed")).toBeUndefined();
      expect(await store.results.findByOwner("tok-doomed")).toHaveLength(0);

      // Safe is untouched
      expect(await store.sessions.findByToken("tok-safe")).toBeTruthy();
      expect(await store.results.findByOwner("tok-safe")).toHaveLength(1);
    });
  });
});
