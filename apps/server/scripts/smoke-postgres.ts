/**
 * Live Postgres round-trip (MPG-133).
 *
 * The unit suite proves the repos in isolation and the contract suite proves
 * both adapters agree. Neither proves the thing this script does: that the
 * *production HTTP app*, built from the environment exactly as a deployment
 * builds it, completes a real player's journey against a real database.
 *
 * That gap is not theoretical. Every live verification before this one ran on
 * the in-memory fallback, which has no foreign keys, no unique-constraint NULL
 * semantics, and no driver — so three whole classes of failure were invisible.
 *
 * Usage:
 *   docker compose up -d
 *   DATABASE_URL=postgres://mpg:mpg_local@localhost:5432/mpg_dev \
 *     pnpm --filter @mpg/server db:migrate
 *   DATABASE_URL=... pnpm --filter @mpg/server db:smoke
 *
 * The script is self-cleaning: every row it writes hangs off session tokens
 * prefixed `smoke-`, and the final step deletes them through the real "forget
 * me" path — which is also how the retention sweep gets exercised. It is
 * therefore safe against a shared database, but it does write, so point it at
 * staging rather than production.
 */

import type { Server } from "node:http";

import { getRealtimeGame } from "@mpg/engine";

import { createServerlessApiApp } from "../src/apiApp.js";
import { forgetMe, rollingRetention } from "../src/retention/retention.js";
import { createStore } from "../src/store/index.js";
import { SESSION_HEADER } from "../src/sessions/sessionMiddleware.js";

// ---------------------------------------------------------------------------
// Tiny assertion harness — no test runner, because this is not a test: it runs
// against live infrastructure and must be runnable from a deploy pipeline.
// ---------------------------------------------------------------------------

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failures += 1;
  console.error(`  ✗ ${label}`);
  if (detail !== undefined) console.error(`     got: ${JSON.stringify(detail)}`);
}

function step(title: string): void {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Tic-Tac-Toe: seat 1 takes the top row, seat 2 answers on the middle. */
const WINNING_LOG = [
  { slot: 1, move: { cell: 0 } },
  { slot: 2, move: { cell: 3 } },
  { slot: 1, move: { cell: 1 } },
  { slot: 2, move: { cell: 4 } },
  { slot: 1, move: { cell: 2 } },
];

const SEATS = [
  { slot: 1, kind: "human" },
  { slot: 2, kind: "bot", difficulty: "medium" },
];

/** A run the server can replay and agree with — the only kind it will accept. */
function genuineFloppyRun(seed: number): { inputLog: boolean[]; score: number } {
  const floppy = getRealtimeGame("floppy-birds");
  let state = floppy.createInitialState(seed);
  const inputLog: boolean[] = [];
  let guard = 0;
  while (!floppy.isGameOver(state)) {
    inputLog.push(false);
    state = floppy.tick(state, false);
    guard += 1;
    if (guard > 10_000) throw new Error("floppy-birds run never ended — fixture bug");
  }
  return { inputLog, score: floppy.getScore(state) };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error(
      "DATABASE_URL is required — this script exists to exercise the Postgres path.\n" +
        "  docker compose up -d\n" +
        "  DATABASE_URL=postgres://mpg:mpg_local@localhost:5432/mpg_dev pnpm --filter @mpg/server db:smoke",
    );
    process.exit(2);
  }

  // Redact credentials: this output is meant to be readable in a CI log.
  console.log(`Postgres round-trip against ${url.replace(/\/\/[^@]*@/, "//***@")}`);

  // Registers the built-in games itself — deliberately not done here, so the
  // script exercises the same assembly a deployment does rather than a variant.
  const app = await createServerlessApiApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("expected a network address");
  const base = `http://127.0.0.1:${address.port}`;

  // A second handle on the same database, for asserting what actually landed
  // rather than trusting the response body.
  const store = await createStore();

  const stamp = Date.now().toString(36);
  const ALICE = `smoke-alice-${stamp}`;
  const ALICE_2ND_DEVICE = `smoke-alice2-${stamp}`;
  const tokens = [ALICE, ALICE_2ND_DEVICE];

  function call(path: string, token?: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { [SESSION_HEADER]: token } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  try {
    // -- 1. Session ---------------------------------------------------------
    step("1. Session — the row every other table hangs off");
    const sessionRes = await call("/api/session", ALICE);
    check("GET /api/session answers 200", sessionRes.status === 200, sessionRes.status);
    check("the session row is persisted", Boolean(await store.sessions.findByToken(ALICE)));

    // -- 2. Result ----------------------------------------------------------
    step("2. Game → result — the server replays the log and derives the outcome");
    const resultRes = await call("/api/results", ALICE, {
      method: "POST",
      body: JSON.stringify({
        runId: `smoke-run-${stamp}`,
        gameId: "tictactoe",
        moveLog: WINNING_LOG,
        seatsSnapshot: SEATS,
      }),
    });
    check("POST /api/results answers 201", resultRes.status === 201, resultRes.status);
    const { resultId } = (await resultRes.json()) as { resultId: string };

    const savedResult = await store.results.findById(resultId);
    check("the result row is persisted", savedResult !== undefined);
    check("the outcome is the replayed one (seat 1 wins)", savedResult?.winnerSlot === 1, {
      status: savedResult?.status,
      winnerSlot: savedResult?.winnerSlot,
    });

    // -- 3. Score submission ------------------------------------------------
    step("3. Score submission — the accumulating upsert (needs a real unique key)");
    const run = genuineFloppyRun(7);
    const submit = (runId: string): Promise<Response> =>
      call("/api/leaderboard/floppy-birds/submit", ALICE, {
        method: "POST",
        body: JSON.stringify({ seed: 7, inputLog: run.inputLog, runId, score: run.score }),
      });

    const firstSubmit = await submit(`smoke-lb-1-${stamp}`);
    check("POST .../submit answers 200", firstSubmit.status === 200, firstSubmit.status);
    await submit(`smoke-lb-2-${stamp}`);

    // The crux. Two submissions from one player must accumulate into ONE row.
    // Before MPG-133 the "unique" key contained two nullable columns, so on the
    // default leaderboard (no event, no time bucket) `ON CONFLICT` never fired
    // and this player appeared twice, with one game each, forever.
    const entries = await store.leaderboard.topN("floppy-birds", "score", 100);
    const mine = entries.filter((e) => e.ownerToken === ALICE);
    check("two submissions collapse to one leaderboard row", mine.length === 1, {
      rows: mine.length,
    });
    check("and the counters accumulated", mine[0]?.totalGames === 2, mine[0]?.totalGames);

    // -- 4. Share link ------------------------------------------------------
    step("4. Share link — mint, resolve as a stranger, revoke");
    const mintRes = await call("/api/share", ALICE, {
      method: "POST",
      body: JSON.stringify({ kind: "result", targetId: resultId }),
    });
    check("POST /api/share answers 201", mintRes.status === 201, mintRes.status);
    const { token: shareToken } = (await mintRes.json()) as { token: string };

    // No session header: a stranger opening the link in a fresh browser.
    const resolveRes = await call(`/api/share/${shareToken}`);
    check("a stranger resolves the link (200)", resolveRes.status === 200, resolveRes.status);
    const resolvedBody = await resolveRes.text();
    check("the resolved payload never leaks the owner token", !resolvedBody.includes(ALICE));

    const revokeRes = await call(`/api/share/${shareToken}`, ALICE, { method: "DELETE" });
    check("the owner revokes it", revokeRes.ok, revokeRes.status);
    const afterRevoke = await call(`/api/share/${shareToken}`);
    check("the revoked link stops resolving (404)", afterRevoke.status === 404, afterRevoke.status);

    // -- 5. Variants (MPG-089-a tables) -------------------------------------
    step("5. Variant tables — save, and the link it auto-mints");
    const variantRes = await call("/api/variants", ALICE, {
      method: "POST",
      body: JSON.stringify({
        baseGameId: "nim",
        name: `Smoke Nim ${stamp}`,
        cosmetics: { theme: "neon", piece: "orb" },
      }),
    });
    check("POST /api/variants answers 201", variantRes.status === 201, variantRes.status);
    const variantBody = (await variantRes.json()) as {
      variant: { id: string };
      share: { token: string };
    };
    check(
      "the variant row is persisted, owner-scoped",
      (await store.variants.findByOwner(ALICE)).some((v) => v.id === variantBody.variant.id),
    );
    const variantLink = await call(`/api/share/${variantBody.share.token}`);
    check("its auto-minted link resolves", variantLink.status === 200, variantLink.status);

    // -- 6. Union reads (MPG-091-b) -----------------------------------------
    step("6. Union reads — one identity, two devices, one history");
    const claimRes = await call("/api/identity/claim", ALICE, {
      method: "POST",
      body: JSON.stringify({ handle: `Smoke${stamp.slice(-6)}` }),
    });
    check("POST /api/identity/claim answers 201", claimRes.status === 201, claimRes.status);
    const { recoveryCode } = (await claimRes.json()) as { recoveryCode: string };

    const adoptRes = await call("/api/identity/adopt", ALICE_2ND_DEVICE, {
      method: "POST",
      body: JSON.stringify({ recoveryCode }),
    });
    check("a second device adopts the identity", adoptRes.ok, adoptRes.status);

    // The union read: the second device never played, but shares the identity,
    // so it must see the first device's game.
    const historyRes = await call("/api/session/history", ALICE_2ND_DEVICE);
    const history = (await historyRes.json()) as { results?: { id: string }[] };
    check(
      "the second device sees the first device's result",
      (history.results ?? []).some((r) => r.id === resultId),
      history,
    );

    const rankRes = await call("/api/leaderboard/floppy-birds/rank?metric=score", ALICE_2ND_DEVICE);
    const rank = (await rankRes.json()) as { rank: number | null };
    check("and ranks on the first device's score", rank.rank !== null, rank);

    // -- 7. Retention -------------------------------------------------------
    step("7. Retention — the rolling sweep, then forget-me");
    const sweep = await rollingRetention(store);
    check("the rolling sweep completes against Postgres", typeof sweep.results === "number", sweep);
    check(
      "and spares this run's fresh rows",
      (await store.results.findById(resultId)) !== undefined,
    );
  } finally {
    // -- 8. Cleanup = the forget-me path ------------------------------------
    step("8. Forget me — the cleanup IS the verification");
    for (const token of tokens) {
      const stats = await forgetMe(store, token);
      console.log(`  · ${token}: ${JSON.stringify(stats)}`);
    }
    for (const token of tokens) {
      check(`nothing remains for ${token}`, (await store.results.findByOwner(token)).length === 0);
      check(`the session itself is gone (${token})`, !(await store.sessions.findByToken(token)));
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks against Postgres`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
