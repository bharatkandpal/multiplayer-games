/**
 * The serverless API, driven through the real Vercel function, over real HTTP.
 *
 * `catchAll.test.ts` covers the packaging seam with the app mocked out — it
 * proves the handler builds once and forwards faithfully, and deliberately
 * knows nothing about routes. This file is the other half: the SAME exported
 * handler from `api/[...path].ts`, behind a real `node:http` server, answering
 * real `fetch` calls against the real Express app and the real engine. Nothing
 * about a request's shape is simulated — if Vercel's rewrite would deliver
 * `/api/leaderboard/drunk-walk/rank`, that is the string this suite sends.
 *
 * ## Why this exists
 *
 * Every production bug this workspace has had was invisible to a unit test and
 * to a green deploy: a handler that could not boot, a catch-all that never
 * matched two path segments, a font resvg ignored. They were all found by
 * issuing a request. This file makes issuing requests cheap and local, so the
 * next one is found here rather than on mpg-api-pink.
 *
 * ## Storage: in-memory by default, Postgres when you ask
 *
 * The app is assembled through `createStore()`, the same factory the container
 * uses, which picks its adapter from the environment:
 *
 *   • no `DATABASE_URL`  → in-memory. Zero setup, runs in `pnpm test`.
 *   • `DATABASE_URL` set → Postgres, exercising the actual SQL.
 *
 * **Run it against Postgres before trusting a storage change.** The in-memory
 * adapter accepts anything a `Map` accepts, so it cannot see column types or
 * constraints — which is exactly how MPG-133's three bugs shipped, and how
 * `POST /api/share` with `kind: "leaderboard"` 500'd in production from the day
 * it shipped: `share_links.target_id` was a `uuid` column, but a leaderboard
 * link's target is a game id like `connect4`. Migration 0006 widened it to
 * `text`; this file found it, and now guards it.
 *
 *   docker compose up -d postgres
 *   DATABASE_URL='postgres://mpg:mpg_local@127.0.0.1:5432/mpg_dev' \
 *     pnpm --filter @mpg/server db:migrate
 *   DATABASE_URL='postgres://mpg:mpg_local@127.0.0.1:5432/mpg_dev' \
 *     pnpm --filter @mpg/api test
 *
 * The one thing mocked is `createServerlessApiApp`, and only to swap that store
 * selection in — its production job is refusing to boot without `DATABASE_URL`,
 * which `databaseUrlGuard.test.ts` covers against the real module. Every router,
 * middleware, and engine call below is the real one.
 */

import { createServer, type Server } from "node:http";

import { getRealtimeGame, registerBuiltInGames, registerBuiltInRealtimeGames } from "@mpg/engine";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createStoreSink } from "../../server/src/analytics/sink.js";
import { createStore } from "../../server/src/store/index.js";

// Swap in the environment-selected store; keep everything else real. Mocking by
// package specifier still intercepts the handler's `./_bundle/app.js` import —
// vitest.config.ts aliases that back to this same source file.
vi.mock("@mpg/server/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/src/apiApp.js")>();
  return {
    ...actual,
    createServerlessApiApp: async () => {
      registerBuiltInGames();
      registerBuiltInRealtimeGames();
      const store = await createStore();
      return actual.createApiApp({ store, eventSink: createStoreSink(store.events) });
    },
  };
});

const USING_POSTGRES = Boolean(process.env["DATABASE_URL"]);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: handler } = (await import("../api/[...path].js")) as {
    default: (req: VercelRequest, res: VercelResponse) => Promise<void>;
  };
  server = await new Promise<Server>((resolve) => {
    const s = createServer((req, res) => {
      void handler(req as VercelRequest, res as VercelResponse);
    });
    s.listen(0, () => resolve(s));
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("expected a network address");
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Fail fast, loudly, here. The handler builds its app lazily on the first
  // request and caches the PROMISE — so if the app cannot be built (the mock
  // not applying, a Postgres that is not up), every request rejects without
  // ever answering, and the suite spends its full timeout hanging on fetches
  // instead of reporting the one real problem. One probe up front turns that
  // into a single readable failure.
  const probe = await fetch(`${baseUrl}/api/session`).catch((cause: unknown) => {
    throw new Error(`The API function could not answer a request: ${String(cause)}`);
  });
  if (!probe.ok) {
    throw new Error(
      `The API function failed to boot (HTTP ${probe.status}). ` +
        (USING_POSTGRES
          ? `Is Postgres up and migrated? DATABASE_URL=${process.env["DATABASE_URL"]}`
          : "Expected the in-memory store — check the createServerlessApiApp mock above."),
    );
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * One request through the function. `token` travels in the header, as in prod.
 *
 * `body` is typed loosely on the way out and on the way back: these tests send
 * deliberately malformed payloads and assert on error envelopes, so a precise
 * type here would fight the point of the file.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above */
type ResponseBody = any;

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: ResponseBody; token: string | null }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["x-session-token"] = opts.token;
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  // Spread the body in rather than passing `undefined` — `exactOptionalPropertyTypes`
  // makes an explicit `body: undefined` a type error against `RequestInit`.
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON (the card PNG, Express's 404 HTML) — hand back the raw text */
  }
  return { status: res.status, body: parsed, token: res.headers.get("x-session-token") };
}

/** A fresh anonymous session, the way every client starts. */
async function newSession(): Promise<string> {
  const res = await call("GET", "/api/session");
  expect(res.status).toBe(200);
  return res.body.token as string;
}

/** Unique per run so repeated Postgres runs never collide on `runId`. */
const runId = (label: string) =>
  `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * A complete drunk-walk run, replayed locally to derive its score.
 *
 * The server re-simulates `{seed, inputLog}` and trusts the declared score only
 * if its own replay agrees, so the score cannot be hardcoded — it is whatever
 * the engine says. Never tapping means never correcting the lean, so the
 * character falls on its own and the run reaches game over in a few hundred
 * ticks, with no input strategy to keep in sync with the game's balance tuning.
 */
type DrunkWalkInput = { tap: null };

function playDrunkWalk(seed: number): {
  seed: number;
  inputLog: DrunkWalkInput[];
  score: number;
} {
  // Registration happens once, in the mocked factory — the registry throws on a
  // second attempt, so this must not re-register.
  const game = getRealtimeGame("drunk-walk");
  let state = game.createInitialState(seed);
  const inputLog: DrunkWalkInput[] = [];
  while (!game.isGameOver(state) && inputLog.length < 10_000) {
    const input: DrunkWalkInput = { tap: null };
    inputLog.push(input);
    state = game.tick(state, input);
  }
  expect(game.isGameOver(state), "the run should end on its own").toBe(true);
  return { seed, inputLog, score: game.getScore(state) };
}

/** A Connect Four win for slot 1: it stacks column 0 while slot 2 stacks column 1. */
const CONNECT_FOUR_WIN = {
  gameId: "connect4",
  durationMs: 4200,
  seatsSnapshot: [
    { slot: 1, kind: "human" },
    { slot: 2, kind: "bot", difficulty: "easy" },
  ],
  moveLog: [
    { slot: 1, move: { column: 0 } },
    { slot: 2, move: { column: 1 } },
    { slot: 1, move: { column: 0 } },
    { slot: 2, move: { column: 1 } },
    { slot: 1, move: { column: 0 } },
    { slot: 2, move: { column: 1 } },
    { slot: 1, move: { column: 0 } },
  ],
};

describe(`serverless API (${USING_POSTGRES ? "Postgres" : "in-memory"})`, () => {
  describe("sessions", () => {
    it("mints an anonymous session and returns it in the header too", async () => {
      const res = await call("GET", "/api/session");
      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.username).toBeNull();
      expect(res.token).toBe(res.body.token);
    });

    it("resolves the same session when the token is presented", async () => {
      const token = await newSession();
      const again = await call("GET", "/api/session", { token });
      expect(again.body.token).toBe(token);
    });

    it("sets and reads back a username", async () => {
      const token = await newSession();
      // Handles are `[a-zA-Z0-9_-]{3,20}` and unique, so no spaces and a fresh
      // one per run (a Postgres run would otherwise 409 the second time).
      const username = `Otter_${Date.now().toString(36)}`.slice(0, 20);

      const set = await call("POST", "/api/session/username", { token, body: { username } });
      expect(set.status).toBe(200);

      const read = await call("GET", "/api/session", { token });
      expect(read.body.username).toBe(username);
    });

    it("rejects a username the moderator will not allow", async () => {
      const token = await newSession();
      const res = await call("POST", "/api/session/username", {
        token,
        body: { username: "no spaces allowed" },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("INVALID_USERNAME");
    });

    it("starts with an empty history and no identity claim", async () => {
      const token = await newSession();
      expect((await call("GET", "/api/session/history", { token })).body).toEqual({ results: [] });
      expect((await call("GET", "/api/identity", { token })).body).toEqual({
        handle: null,
        claimed: false,
      });
    });
  });

  describe("leaderboard scores", () => {
    it("accepts a replay-validated score and reads it back on the board", async () => {
      const token = await newSession();
      const run = playDrunkWalk(20260921);
      const id = runId("score");

      const submit = await call("POST", "/api/leaderboard/drunk-walk/submit", {
        token,
        body: { runId: id, seed: run.seed, inputLog: run.inputLog, score: run.score },
      });
      expect(submit.status).toBe(200);
      expect(submit.body.ok).toBe(true);
      expect(submit.body.entry.bestScore).toBe(run.score);

      // `?metric=score` is REQUIRED for a realtime game. The route's default is
      // `wld` (the win/loss/draw metric turn-based games write), so a score
      // board queried without it comes back empty — see the test below.
      const board = await call("GET", "/api/leaderboard/drunk-walk?metric=score", { token });
      expect(board.status).toBe(200);
      const mine = (board.body.entries as { bestScore: number }[]).find(
        (e) => e.bestScore === run.score,
      );
      expect(mine, "the submitted score should appear on the board").toBeDefined();
    });

    it("hides score entries behind the default `wld` metric", async () => {
      // Not a bug — a contract worth pinning. Scores and win/loss records are
      // separate metrics on the same board, and asking for the wrong one
      // returns an empty list rather than an error, so a client that forgets
      // `?metric=score` sees "no scores yet" and no clue why.
      const token = await newSession();
      const run = playDrunkWalk(2468);
      await call("POST", "/api/leaderboard/drunk-walk/submit", {
        token,
        body: { runId: runId("metric"), seed: run.seed, inputLog: run.inputLog, score: run.score },
      });

      expect((await call("GET", "/api/leaderboard/drunk-walk", { token })).body.entries).toEqual(
        [],
      );
      expect(
        (await call("GET", "/api/leaderboard/drunk-walk?metric=score", { token })).body.entries
          .length,
      ).toBeGreaterThan(0);
    });

    it("reports the submitter's own rank", async () => {
      const token = await newSession();
      const run = playDrunkWalk(777);
      await call("POST", "/api/leaderboard/drunk-walk/submit", {
        token,
        body: { runId: runId("rank"), seed: run.seed, inputLog: run.inputLog, score: run.score },
      });

      const rank = await call("GET", "/api/leaderboard/drunk-walk/rank?metric=score", { token });
      expect(rank.status).toBe(200);
      expect(rank.body.rank).toBeGreaterThanOrEqual(1);
      expect(rank.body.entry.bestScore).toBe(run.score);
    });

    it("is idempotent on runId — a retry does not post a second score", async () => {
      const token = await newSession();
      const run = playDrunkWalk(31337);
      const id = runId("idem");
      const body = { runId: id, seed: run.seed, inputLog: run.inputLog, score: run.score };

      expect(
        (await call("POST", "/api/leaderboard/drunk-walk/submit", { token, body })).status,
      ).toBe(200);
      const retry = await call("POST", "/api/leaderboard/drunk-walk/submit", { token, body });

      expect(retry.status).toBe(200);
      expect(retry.body.duplicate).toBe(true);
    });

    it("rejects a score the replay does not agree with", async () => {
      const token = await newSession();
      const run = playDrunkWalk(4242);

      const res = await call("POST", "/api/leaderboard/drunk-walk/submit", {
        token,
        body: {
          runId: runId("forged"),
          seed: run.seed,
          inputLog: run.inputLog,
          score: run.score + 100_000,
        },
      });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe("SCORE_MISMATCH");
    });

    it("rejects an unregistered game", async () => {
      const token = await newSession();
      const res = await call("POST", "/api/leaderboard/not-a-game/submit", {
        token,
        body: { runId: runId("nogame"), seed: 1, inputLog: [], score: 0 },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("UNKNOWN_GAME");
    });

    it("answers 200 with an empty board for a game id that does not exist", async () => {
      // The read route does NOT validate the id — an unknown game is indistinguishable
      // from a real game nobody has played yet. That is how the deploy smoke probed
      // `connect-four` (not a registered id; it is `connect4`) for a month and passed
      // every time. Pinned here so the looseness is a decision, not a surprise.
      //
      // A random id rather than a real one on purpose: against a shared dev
      // database, any actual game may already have rows.
      const res = await call("GET", `/api/leaderboard/no-such-game-${Date.now()}`);
      expect(res.status).toBe(200);
      expect(res.body.entries).toEqual([]);
    });
  });

  describe("turn-based results", () => {
    it("persists a replay-validated win and derives the outcome itself", async () => {
      const token = await newSession();
      const res = await call("POST", "/api/results", {
        token,
        body: { ...CONNECT_FOUR_WIN, runId: runId("result") },
      });

      expect(res.status).toBe(201);
      expect(res.body.resultId).toEqual(expect.any(String));

      const history = await call("GET", "/api/session/history", { token });
      const saved = history.body.results[0];
      // The client never sent an outcome — the server replayed the log for it.
      expect(saved.status).toBe("win");
      expect(saved.winnerSlot).toBe(1);
      expect(saved.gameId).toBe("connect4");
    });

    it("is idempotent on runId", async () => {
      const token = await newSession();
      const body = { ...CONNECT_FOUR_WIN, runId: runId("result-idem") };

      const first = await call("POST", "/api/results", { token, body });
      const second = await call("POST", "/api/results", { token, body });

      expect(second.body.duplicate).toBe(true);
      expect(second.body.resultId).toBe(first.body.resultId);
    });

    it("rejects a move log that breaks the rules", async () => {
      const token = await newSession();
      const res = await call("POST", "/api/results", {
        token,
        body: {
          ...CONNECT_FOUR_WIN,
          runId: runId("illegal"),
          // Slot 2 playing twice in a row is not a legal turn order.
          moveLog: [
            { slot: 2, move: { column: 0 } },
            { slot: 2, move: { column: 1 } },
          ],
        },
      });
      expect(res.status).toBe(422);
    });

    it("rejects an unknown game", async () => {
      const token = await newSession();
      const res = await call("POST", "/api/results", {
        token,
        body: { ...CONNECT_FOUR_WIN, gameId: "not-a-game", runId: runId("badgame") },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("UNKNOWN_GAME");
    });
  });

  describe("share links and the unfurl card", () => {
    async function shareAResult(token: string): Promise<string> {
      const result = await call("POST", "/api/results", {
        token,
        body: { ...CONNECT_FOUR_WIN, runId: runId("share") },
      });
      const share = await call("POST", "/api/share", {
        token,
        body: { kind: "result", targetId: result.body.resultId },
      });
      expect(share.status).toBe(201);
      return share.body.token as string;
    }

    it("mints a link a stranger can resolve without a session", async () => {
      const shareToken = await shareAResult(await newSession());

      const resolved = await call("GET", `/api/share/${shareToken}`);
      expect(resolved.status).toBe(200);
      expect(resolved.body.kind).toBe("result");
      expect(resolved.body.result.winnerSlot).toBe(1);
      // The public projection must not leak who owns it or how it was played.
      expect(resolved.body.result.ownerToken).toBeUndefined();
      expect(resolved.body.result.moveLog).toBeUndefined();
    });

    it("renders the card PNG the og:image points at", async () => {
      const shareToken = await shareAResult(await newSession());

      const res = await fetch(`${baseUrl}/api/cards/${shareToken}.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");

      const png = Buffer.from(await res.arrayBuffer());
      expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      // Blankness is covered by pixel count in the server's raster.test.ts; here
      // we only care that the route wired the renderer up at all.
      expect(png.byteLength).toBeGreaterThan(10_000);
    });

    it("revokes a link, and the card goes with it", async () => {
      const token = await newSession();
      const shareToken = await shareAResult(token);

      expect((await call("DELETE", `/api/share/${shareToken}`, { token })).status).toBe(204);
      expect((await call("GET", `/api/share/${shareToken}`)).status).toBe(404);
      expect((await fetch(`${baseUrl}/api/cards/${shareToken}.png`)).status).toBe(404);
    });

    it("404s a token that was never minted", async () => {
      const res = await call("GET", "/api/share/nope-not-a-real-token");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("LINK_NOT_FOUND");
    });

    it("refuses to share a result the session does not own", async () => {
      const owner = await newSession();
      const result = await call("POST", "/api/results", {
        token: owner,
        body: { ...CONNECT_FOUR_WIN, runId: runId("notmine") },
      });

      const stranger = await newSession();
      const res = await call("POST", "/api/share", {
        token: stranger,
        body: { kind: "result", targetId: result.body.resultId },
      });

      // Deliberately the same 404 as "no such result", so ids cannot be probed.
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("TARGET_NOT_FOUND");
    });

    it("mints a leaderboard link, whose target is a game id and not a row id", async () => {
      // The regression guard for migration 0006. While `target_id` was a `uuid`
      // column this insert 500'd on Postgres and passed in memory, which is how
      // it survived in production from the day the endpoint shipped. Asserted
      // unconditionally now — the two stores must agree.
      const token = await newSession();
      const res = await call("POST", "/api/share", {
        token,
        body: { kind: "leaderboard", targetId: "connect4" },
      });

      expect(res.status).toBe(201);
      expect(res.body.kind).toBe("leaderboard");

      // And it round-trips: a stranger resolving it gets the game id back.
      const resolved = await call("GET", `/api/share/${res.body.token}`);
      expect(resolved.status).toBe(200);
      expect(resolved.body).toMatchObject({ kind: "leaderboard", gameId: "connect4" });
    });

    it("has no card for a leaderboard link", async () => {
      // Nothing to draw — a leaderboard is nobody's result. Must 404 rather
      // than reach the renderer with a game id where a row id is expected.
      const token = await newSession();
      const link = await call("POST", "/api/share", {
        token,
        body: { kind: "leaderboard", targetId: "connect4" },
      });

      expect((await fetch(`${baseUrl}/api/cards/${link.body.token}.png`)).status).toBe(404);
    });
  });

  describe("analytics events", () => {
    it("accepts a batch of client-reportable events", async () => {
      const token = await newSession();
      const res = await call("POST", "/api/events", {
        token,
        body: { events: [{ name: "first_input", gameId: "connect4" }] },
      });

      // 202, not 201 — the sink may drop rather than fail (see createStoreSink).
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ accepted: 1, dropped: 0 });
    });

    it("drops a server-owned event name instead of trusting the client", async () => {
      // `share_minted` is the share-rate numerator; accepting it from a browser
      // would let anyone with curl inflate the funnel.
      const token = await newSession();
      const res = await call("POST", "/api/events", {
        token,
        body: { events: [{ name: "share_minted" }] },
      });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ accepted: 0, dropped: 1 });
    });

    it("rejects a body that is not a batch", async () => {
      const res = await call("POST", "/api/events", { body: { nope: true } });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("INVALID_REQUEST");
    });
  });

  describe("routing through the catch-all", () => {
    // The bug this guards: Vercel generated `^/api/([^/]+)$` for the catch-all,
    // so every two-segment path 404'd at the platform before reaching Express.
    it.each([
      ["/api/session", 200],
      ["/api/leaderboard/connect4", 200],
      ["/api/leaderboard/connect4/rank", 200],
    ])("reaches the app at %s", async (path, expected) => {
      expect((await call("GET", path)).status).toBe(expected);
    });

    it("404s an unknown path without crashing the function", async () => {
      expect((await call("GET", "/api/nope/deeper/still")).status).toBe(404);
      // Still alive afterwards.
      expect((await call("GET", "/api/session")).status).toBe(200);
    });
  });
});
