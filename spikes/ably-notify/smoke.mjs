// Headless proof of the Ably notify plumbing — no browser, no npm deps.
// Run: node --env-file=.env.local smoke.mjs
//
// Proves, server-side: (1) a token minted for room:A is scoped to exactly that
// channel (subscribe-only); (2) the server can publish to a room channel;
// (3) the message actually landed (read back via REST history). The live push
// latency + the wrong-room rejection are the browser harness's job (index.html).

const ABLY_KEY = process.env.ABLY_API_KEY;
if (!ABLY_KEY || !ABLY_KEY.includes(":")) {
  console.error("Missing ABLY_API_KEY (appId.keyId:secret) — add it to .env.local");
  process.exit(1);
}
const KEY_NAME = ABLY_KEY.slice(0, ABLY_KEY.indexOf(":"));
const AUTH = "Basic " + Buffer.from(ABLY_KEY).toString("base64");
const REST = "https://rest.ably.io";
const H = { Authorization: AUTH, "Content-Type": "application/json" };

const roomId = "smoke-" + Date.now();
const channel = `room:${roomId}`;
let failed = false;
const ok = (m) => console.log("  ✅ " + m);
const bad = (m) => { failed = true; console.log("  ❌ " + m); };

// 1) Mint a scoped token and inspect its capability.
const tokRes = await fetch(`${REST}/keys/${KEY_NAME}/requestToken`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ keyName: KEY_NAME, capability: JSON.stringify({ [channel]: ["subscribe"] }), clientId: "smoke", ttl: 60_000, timestamp: Date.now() }),
});
if (!tokRes.ok) { bad(`token mint failed ${tokRes.status}: ${await tokRes.text()}`); process.exit(1); }
const token = await tokRes.json();
const cap = JSON.parse(token.capability);
console.log("\n  token.capability =", token.capability);
const keys = Object.keys(cap);
if (keys.length === 1 && keys[0] === channel) ok(`token scoped to exactly ${channel}`);
else bad(`token scope is ${JSON.stringify(keys)}, expected only [${channel}]`);
if (Array.isArray(cap[channel]) && cap[channel].join() === "subscribe") ok("subscribe-only (no publish capability for clients)");
else bad(`capability ops are ${JSON.stringify(cap[channel])}, expected ["subscribe"]`);

// 2) Publish a move ping from the "server".
const pubRes = await fetch(`${REST}/channels/${encodeURIComponent(channel)}/messages`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ name: "update", data: { v: 1, serverTs: Date.now() } }),
});
pubRes.ok ? ok("server published { v:1 } to the room channel") : bad(`publish failed ${pubRes.status}: ${await pubRes.text()}`);

// 3) Read it back via history (proves it actually landed).
await new Promise((r) => setTimeout(r, 500));
const histRes = await fetch(`${REST}/channels/${encodeURIComponent(channel)}/messages?limit=1`, { headers: { Authorization: AUTH } });
if (!histRes.ok) bad(`history failed ${histRes.status}: ${await histRes.text()}`);
else {
  const hist = await histRes.json();
  // Ably history returns `data` as a JSON string when encoding === "json".
  let got = hist[0]?.data;
  if (typeof got === "string") { try { got = JSON.parse(got); } catch {} }
  if (got && got.v === 1) ok(`history confirms the ping (v=${got.v})`);
  else bad(`history did not return the ping: ${JSON.stringify(hist)}`);
}

console.log(failed ? "\n  SMOKE FAILED\n" : "\n  SMOKE PASSED — notify plumbing works end to end\n");
process.exit(failed ? 1 : 0);
