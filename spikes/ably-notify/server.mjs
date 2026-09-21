// Throwaway spike (ADR 0010 amendment, 2026-09-21): prove the Ably notify hop.
//
// Models the "ping-then-fetch" contract with NO production code and NO npm deps
// — every Ably interaction is a plain REST call over `fetch`:
//
//   POST /rooms/:id/moves  → the mover's move endpoint. Bumps an in-memory
//                            version (stands in for the Neon RoomRepo + version
//                            guard), then FIRE-AND-FORGET publishes `{ v }` to
//                            channel `room:<id>` via Ably REST. Returns the new
//                            version synchronously (the mover's fast path).
//   GET  /rooms/:id        → authoritative re-fetch target (stands in for the
//                            server-derived PublicRoom).
//   POST /token            → mints an Ably TokenDetails whose capability is
//                            scoped to EXACTLY `room:<id>` subscribe — the
//                            per-room authorization the amendment puts in our
//                            own function instead of RLS. Clients get NO publish
//                            capability, so only the server can push (authority).
//
// Run:  node --env-file=.env.local server.mjs   (needs ABLY_API_KEY=appId.key:secret)
// Then open http://localhost:8787

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = Number(process.env.PORT ?? 8787);
const ABLY_KEY = process.env.ABLY_API_KEY;
const HERE = dirname(fileURLToPath(import.meta.url));

if (!ABLY_KEY || !ABLY_KEY.includes(":")) {
  console.error(
    "\n  Missing ABLY_API_KEY (format: appId.keyId:secret).\n" +
      "  Add it to spikes/ably-notify/.env.local and run:\n" +
      "    node --env-file=.env.local server.mjs\n",
  );
  process.exit(1);
}

const KEY_NAME = ABLY_KEY.slice(0, ABLY_KEY.indexOf(":"));
const AUTH = "Basic " + Buffer.from(ABLY_KEY).toString("base64");
const ABLY_REST = "https://rest.ably.io";

// In-memory "RoomRepo": id → monotonic version. Correctness of the spike does
// not depend on durability; this only stands in for the Neon row + version.
const versions = new Map();
const channelFor = (id) => `room:${id}`;

async function mintToken(roomId, clientId) {
  // Capability scoped to this one room, subscribe-only. A client cannot
  // subscribe to a room it wasn't issued a token for, and cannot publish at all.
  const capability = JSON.stringify({ [channelFor(roomId)]: ["subscribe"] });
  const res = await fetch(`${ABLY_REST}/keys/${KEY_NAME}/requestToken`, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ keyName: KEY_NAME, capability, clientId, ttl: 3_600_000, timestamp: Date.now() }),
  });
  if (!res.ok) throw new Error(`requestToken ${res.status}: ${await res.text()}`);
  return res.json(); // TokenDetails — the browser SDK accepts this via authUrl
}

async function publishMove(roomId, v) {
  // Fire-and-forget. In the real design a failed publish is swallowed and the
  // opponent falls back to polling — Neon is already the source of truth.
  const channel = encodeURIComponent(channelFor(roomId));
  const res = await fetch(`${ABLY_REST}/channels/${channel}/messages`, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "update", data: { v, serverTs: Date.now() } }),
  });
  if (!res.ok) throw new Error(`publish ${res.status}: ${await res.text()}`);
}

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const { pathname } = url;

    if (req.method === "GET" && pathname === "/") {
      const html = await readFile(join(HERE, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // POST /token  { roomId, clientId }  → TokenDetails scoped to room:<roomId>
    if (req.method === "POST" && pathname === "/token") {
      const { roomId, clientId } = await readBody(req);
      if (!roomId || !clientId) return json(res, 400, { error: "roomId + clientId required" });
      return json(res, 200, await mintToken(String(roomId), String(clientId)));
    }

    // GET /rooms/:id  → authoritative version (the re-fetch after a ping)
    let m = pathname.match(/^\/rooms\/([^/]+)$/);
    if (req.method === "GET" && m) {
      const id = decodeURIComponent(m[1]);
      return json(res, 200, { roomId: id, v: versions.get(id) ?? 0 });
    }

    // POST /rooms/:id/moves  → bump version, publish ping, return new version
    m = pathname.match(/^\/rooms\/([^/]+)\/moves$/);
    if (req.method === "POST" && m) {
      const id = decodeURIComponent(m[1]);
      const v = (versions.get(id) ?? 0) + 1;
      versions.set(id, v);
      // Commit-then-publish: the version is already stored before we notify.
      await publishMove(id, v);
      return json(res, 200, { roomId: id, v });
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Ably notify spike → http://localhost:${PORT}`);
  console.log(`  Ably key name: ${KEY_NAME}\n`);
});
