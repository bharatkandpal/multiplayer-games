import { createStubAuthority } from "./key-authority.mjs";
import { createChatCrypto, createMemoryRepo } from "./envelope.mjs";
const N = 20000, ch = "chat:p-" + "a".repeat(32);
const authority = createStubAuthority(), repo = createMemoryRepo();
const c = createChatCrypto({ authority, repo });
const text = "x".repeat(60), body = JSON.stringify({ text, senderName: "Ada" }).length;
await c.store({ id: "w", channel: ch, roomId: "r", senderToken: "t", senderName: "Ada", text, ts: 0 }); // warm
let t = performance.now();
for (let i = 0; i < N; i++) await c.store({ id: "m" + i, channel: ch, roomId: "r", senderToken: "t", senderName: "Ada", text, ts: i });
const encUs = ((performance.now() - t) / N) * 1000;
await c.flushWraps();
const row = repo.messages.get("m1"), key = [...repo.roomKeys.values()][0];
console.log(`plaintext body ${body} B -> ciphertext+tag ${row.ciphertext.length} B + nonce ${row.nonce.length} B + dek_gen 8 B`);
console.log(`per-message overhead (per-room DEK): ${row.ciphertext.length - body + row.nonce.length} B (+8 B dek_gen if bigint)`);
console.log(`per-room one-off: wrapped DEK ${key.wrappedDek.length} B + version 4 B + gen 8 B`);
console.log(`alt per-message wrapped DEK would add: ${key.wrappedDek.length + 4} B/row (=> ${row.ciphertext.length - body + row.nonce.length + key.wrappedDek.length + 4} B total)`);
console.log(`encrypt+store (incl. in-mem insert): ${encUs.toFixed(1)} us/msg`);
for (const lat of [0, 20]) {
  authority.sim.latencyMs = lat; c.dropReadCache();
  t = performance.now(); const r = await c.readPage(ch, { limit: 10 });
  const cold = performance.now() - t; t = performance.now();
  for (let i = 0; i < 200; i++) await c.readPage(ch, { limit: 10 });
  console.log(`read newest 10 (${r.status}) cold cache, authority ${lat}ms: ${cold.toFixed(1)} ms; warm: ${((performance.now() - t) / 200).toFixed(3)} ms/page (incl. in-mem sort of ${N} rows)`);
}
