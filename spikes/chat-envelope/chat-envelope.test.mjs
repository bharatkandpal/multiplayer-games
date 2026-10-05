import test from "node:test";
import assert from "node:assert/strict";
import { createStubAuthority } from "./key-authority.mjs";
import { createChatCrypto, createMemoryRepo, channelNameFor } from "./envelope.mjs";

const HMAC = "server-hmac-key";
const mk = (channel, i, text = `hello ${i}`) => ({ id: `m${String(i).padStart(4, "0")}`, channel, roomId: "r1", senderToken: "tok-a", senderName: "Ada", text, ts: 1_000 + i });
function setup(opts) {
  const authority = createStubAuthority(opts), repo = createMemoryRepo();
  return { authority, repo, c: createChatCrypto({ authority, repo, authorityTimeoutMs: 80 }) };
}
const PRIV = channelNameFor("chat", "r1", "royal", HMAC);

test("1+2+5 round trip on a private channel, newest page + cursor paging", async () => {
  assert.match(PRIV, /^chat:p-[0-9a-f]{32}$/);
  const { c } = setup();
  for (let i = 0; i < 25; i++) await c.store(mk(PRIV, i));
  await c.flushWraps();
  c.dropReadCache(); // force real unwrap
  const p1 = await c.readPage(PRIV, { limit: 10 });
  assert.equal(p1.status, "ok");
  assert.deepEqual(p1.messages.map((m) => m.text).slice(0, 2), ["hello 24", "hello 23"]);
  const old = p1.messages.at(-1);
  const p2 = await c.readPage(PRIV, { limit: 10, before: { ts: old.ts, id: old.id } });
  assert.equal(p2.messages[0].text, "hello 14");
  assert.equal(p2.messages.length, 10);
});

test("AAD: rows cannot be swapped between rooms, ids, or timestamps", async () => {
  const { c, repo } = setup();
  const A = channelNameFor("chat", "r1", "a", HMAC), B = channelNameFor("chat", "r2", "b", HMAC);
  await c.store(mk(A, 1, "secret A"));
  await c.store(mk(B, 2, "secret B"));
  const rowA = [...repo.messages.values()].find((r) => r.channel === A);
  // swap channel: B's reader sees A's ciphertext (even with the same DEK it must fail)
  repo.messages.set("evil", { ...rowA, id: "evil", channel: B });
  assert.equal((await c.readPage(B, { limit: 10 })).status, "unavailable");
  repo.messages.delete("evil");
  // retarget id / ts within same channel
  repo.messages.set("evil2", { ...rowA, id: "evil2" });
  assert.equal((await c.readPage(A, { limit: 10 })).status, "unavailable");
  repo.messages.delete("evil2");
  repo.messages.set(rowA.id, { ...rowA, ts: rowA.ts + 1 });
  assert.equal((await c.readPage(A, { limit: 10 })).status, "unavailable");
});

test("AAD: wrapped DEK from room A cannot be installed under room B", async () => {
  const { c, repo, authority } = setup();
  const A = "chat:p-aaaa", B = "chat:p-bbbb";
  await c.store(mk(A, 1)); await c.store(mk(B, 2)); await c.flushWraps(); c.dropReadCache();
  const kA = [...repo.roomKeys.values()].find((k) => k.channel === A);
  const kB = [...repo.roomKeys.values()].find((k) => k.channel === B);
  repo.roomKeys.set(`${B}#${kB.gen}`, { ...kB, wrappedDek: kA.wrappedDek, keyVersion: kA.keyVersion });
  assert.equal((await c.readPage(B, { limit: 5 })).status, "unavailable");
  void authority;
});

test("3 rotation: v1 and v2 readable during rotation; retire v1 after rewrap", async () => {
  const { c, repo, authority } = setup();
  const rooms = ["chat:r-1", "chat:r-2", "chat:r-3"];
  for (const [i, r] of rooms.entries()) await c.store(mk(r, i));
  await c.flushWraps();
  assert.equal(authority.rotate(), 2);
  c.dropReadCache(); c.forgetWriteKeys();
  // new traffic after rotation wraps under v2 (new generation); old rows still v1
  await c.store(mk(rooms[0], 10, "post-rotation")); await c.flushWraps();
  const versions = () => [...repo.roomKeys.values()].map((k) => k.keyVersion).sort();
  assert.deepEqual(versions(), [1, 1, 1, 2]);
  c.dropReadCache();
  const mid = await c.readPage(rooms[0], { limit: 10 }); // mixes v1 + v2 DEKs
  assert.equal(mid.status, "ok"); assert.equal(mid.messages.length, 2);
  // premature retirement is detectable: reads fail closed
  const probe = setup(); // separate world to show the failure mode
  await probe.c.store(mk("chat:x", 1)); await probe.c.flushWraps();
  probe.authority.rotate(); probe.authority.retire(1); probe.c.dropReadCache();
  assert.equal((await probe.c.readPage("chat:x", { limit: 5 })).status, "unavailable");
  // proper path: batch rewrap (in 2 small batches), then retire
  assert.equal(await c.rewrapBatch(2, 2), 2);
  c.dropReadCache();
  assert.equal((await c.readPage(rooms[1], { limit: 5 })).status, "ok"); // half-migrated still fine
  assert.equal(await c.rewrapBatch(2, 2), 1);
  assert.deepEqual(versions(), [2, 2, 2, 2]);
  authority.retire(1); c.dropReadCache();
  for (const r of rooms) assert.equal((await c.readPage(r, { limit: 5 })).status, "ok");
});

test("4 authority down: reads degrade, writes + live path unaffected, DEKs wrap once it recovers", async () => {
  const { c, authority } = setup();
  await c.store(mk("chat:r-1", 1)); await c.flushWraps(); c.dropReadCache();
  authority.sim.down = true;
  const t0 = performance.now();
  const r = await c.readPage("chat:r-1", { limit: 10 });
  assert.equal(r.status, "unavailable"); assert.deepEqual(r.messages, []);
  // writes: existing room after "restart" AND brand new room, while authority is down
  c.forgetWriteKeys();
  await c.store(mk("chat:r-1", 2)); await c.store(mk("chat:r-new", 3));
  assert.ok(performance.now() - t0 < 50, "write path must not wait on authority");
  assert.equal((await c.flushWraps()).pending, 2); // stays pending, no throw
  // slow authority (> timeout) behaves like down, bounded by the timeout
  authority.sim.down = false; authority.sim.latencyMs = 500; c.dropReadCache();
  const t1 = performance.now();
  assert.equal((await c.readPage("chat:r-1", { limit: 10 })).status, "unavailable");
  assert.ok(performance.now() - t1 < 300, "read bounded by timeout");
  // recovery
  authority.sim.latencyMs = 0;
  assert.equal((await c.flushWraps()).pending, 0);
  c.dropReadCache();
  assert.equal((await c.readPage("chat:r-1", { limit: 10 })).messages.length, 2);
});

test("6 DB dump with no authority yields no plaintext", async () => {
  const { c, repo } = setup();
  const needle = "the-eagle-lands-at-midnight", who = "Zaphod-Beeblebrox";
  for (let i = 0; i < 5; i++) await c.store({ ...mk(PRIV, i, `${needle} ${i}`), senderName: who });
  await c.flushWraps();
  const dump = JSON.stringify({ m: [...repo.messages.values()], k: [...repo.roomKeys.values()] }, (_k, v) =>
    v && v.type === "Buffer" ? Buffer.from(v.data).toString("latin1") + Buffer.from(v.data).toString("hex") + Buffer.from(v.data).toString("base64") : v);
  assert.ok(!dump.includes(needle) && !dump.includes(who) && !dump.includes("eagle"));
  // a fresh service with a DIFFERENT authority (attacker) cannot read
  const evil = createChatCrypto({ authority: createStubAuthority(), repo, authorityTimeoutMs: 80 });
  assert.equal((await evil.readPage(PRIV, { limit: 5 })).status, "unavailable");
  // and what stays plaintext is exactly the documented set
  const row = [...repo.messages.values()][0];
  assert.deepEqual(Object.keys(row).sort(), ["channel", "ciphertext", "dekGen", "id", "nonce", "roomId", "senderToken", "ts"]);
});
