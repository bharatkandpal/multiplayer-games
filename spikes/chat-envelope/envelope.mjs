// "Service" side. Imports only the KeyAuthority *interface* (passed in), never master keys.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("authority timeout")), ms))]);

// CHAT-020 derivation, reproduced (apps/server/src/chat/privateChannel.ts).
export const channelNameFor = (prefix, roomId, secret, hmacKey) =>
  secret === null
    ? `${prefix}:${roomId}`
    : `${prefix}:p-${createHmac("sha256", hmacKey).update(`${roomId}\n${secret}`).digest("hex").slice(0, 32)}`;

const dekAad = (channel, gen) => Buffer.from(`mpg-chat-dek|${channel}|${gen}`);
const msgAad = (m, gen) => Buffer.from(`mpg-chat-msg|${m.channel}|${m.id}|${m.ts}|${gen}`);

/**
 * Repo mirrors chat_messages + a small room_keys table.
 *   chat_messages: id, channel, room_id, sender_token, ts   (PLAINTEXT: routing/paging/forget-me)
 *                  ciphertext, nonce, dek_gen               (ENCRYPTED: {text, senderName})
 *   room_keys:     channel, gen, wrapped_dek|null, key_version|null
 * One DEK per (channel, generation), NOT per message: rotation re-wraps O(rooms) rows,
 * not O(messages), and a row costs 28 B overhead instead of ~92.
 */
export function createMemoryRepo() {
  const messages = new Map(); // id -> row
  const roomKeys = new Map(); // `${channel}#${gen}` -> row
  return {
    messages, roomKeys,
    async append(row) { if (!messages.has(row.id)) messages.set(row.id, row); },
    async page(channel, { before, limit }) {
      return [...messages.values()]
        .filter((r) => r.channel === channel && (!before || r.ts < before.ts || (r.ts === before.ts && r.id < before.id)))
        .sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1)).slice(0, limit);
    },
    async putKey(row) { roomKeys.set(`${row.channel}#${row.gen}`, row); },
    async maxGen(channel) { return Math.max(0, ...[...roomKeys.values()].filter((k) => k.channel === channel).map((k) => k.gen)); },
    async getKey(channel, gen) { return roomKeys.get(`${channel}#${gen}`); },
    async keysBelow(version, n) { return [...roomKeys.values()].filter((k) => k.keyVersion !== null && k.keyVersion < version).slice(0, n); },
  };
}

export function createChatCrypto({ authority, repo, authorityTimeoutMs = 250, poolSize = 8 }) {
  const writeKeys = new Map(); // channel -> { gen, dek }   (plaintext DEK, memory only, write path)
  const readKeys = new Map();  // `${channel}#${gen}` -> dek  (unwrapped cache)
  const pool = [];             // pre-generated DEKs (random; wrapped later per channel binding)
  const pendingWrap = new Map(); // `${channel}#${gen}` -> dek, awaiting wrap (survives read-cache drops)
  const t = (p) => withTimeout(p, authorityTimeoutMs);

  /** Write-path key: NEVER touches the authority. Always a local DEK; wrap is deferred. */
  async function writeKeyFor(channel) {
    let k = writeKeys.get(channel);
    if (k) return k;
    // New process / new room => start a NEW generation instead of unwrapping the old one,
    // so a restart during an authority outage never blocks sending.
    const gen = (await repo.maxGen(channel)) + 1; // real impl: PK(channel,gen) + retry on conflict across instances
    const dek = pool.pop() ?? randomBytes(32);
    k = { gen, dek };
    writeKeys.set(channel, k);
    readKeys.set(`${channel}#${gen}`, dek);
    await repo.putKey({ channel, gen, wrappedDek: null, keyVersion: null });
    pendingWrap.set(`${channel}#${gen}`, dek);
    return k;
  }

  /** Background: wrap any pending DEKs (best-effort; retried on next tick). */
  async function flushWraps() {
    let done = 0;
    for (const [id, dek] of [...pendingWrap]) {
      const [channel, genS] = id.split("#"); // channel has ':' but never '#'
      const gen = Number(genS);
      try {
        const { wrapped, version } = await t(authority.wrap(dek, dekAad(channel, gen)));
        await repo.putKey({ channel, gen, wrappedDek: wrapped, keyVersion: version });
        pendingWrap.delete(id); done++;
      } catch { /* authority down: stay pending, plaintext DEK only in RAM */ }
    }
    return { wrapped: done, pending: pendingWrap.size };
  }
  async function refillPool() { while (pool.length < poolSize) pool.push(randomBytes(32)); }

  async function encryptMessage(m) {
    const { gen, dek } = await writeKeyFor(m.channel);
    const nonce = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", dek, nonce);
    c.setAAD(msgAad(m, gen));
    const ct = Buffer.concat([c.update(JSON.stringify({ text: m.text, senderName: m.senderName })), c.final(), c.getAuthTag()]);
    return { id: m.id, channel: m.channel, roomId: m.roomId, senderToken: m.senderToken, ts: m.ts, ciphertext: ct, nonce, dekGen: gen };
  }
  const store = async (m) => repo.append(await encryptMessage(m));

  async function dekFor(channel, gen) {
    const id = `${channel}#${gen}`;
    if (readKeys.has(id)) return readKeys.get(id);
    const row = await repo.getKey(channel, gen);
    if (!row?.wrappedDek) throw new Error("dek unavailable");
    const dek = await t(authority.unwrap(row.wrappedDek, row.keyVersion, dekAad(channel, gen)));
    readKeys.set(id, dek);
    return dek;
  }

  /** Newest-first page. Returns {status:"ok"|"unavailable", messages}. Never throws on authority trouble. */
  async function readPage(channel, opts) {
    const rows = await repo.page(channel, opts);
    try {
      const out = [];
      for (const r of rows) {
        const dek = await dekFor(channel, r.dekGen);
        const d = createDecipheriv("aes-256-gcm", dek, r.nonce);
        d.setAAD(msgAad(r, r.dekGen));
        d.setAuthTag(r.ciphertext.subarray(r.ciphertext.length - 16));
        const body = JSON.parse(Buffer.concat([d.update(r.ciphertext.subarray(0, -16)), d.final()]).toString());
        out.push({ id: r.id, channel, roomId: r.roomId, senderToken: r.senderToken, ts: r.ts, ...body });
      }
      return { status: "ok", messages: out };
    } catch (e) {
      return { status: "unavailable", messages: [], reason: e.message };
    }
  }

  /** Batch rewrap to the authority's current version. Cheap: one row per room-generation. */
  async function rewrapBatch(targetVersion, n = 100) {
    let moved = 0;
    for (const k of await repo.keysBelow(targetVersion, n)) {
      const r = await t(authority.rewrap(k.wrappedDek, k.keyVersion, dekAad(k.channel, k.gen)));
      await repo.putKey({ ...k, wrappedDek: r.wrapped, keyVersion: r.version });
      moved++;
    }
    return moved;
  }
  const dropReadCache = () => readKeys.clear();
  const forgetWriteKeys = () => writeKeys.clear(); // simulates process restart
  return { store, encryptMessage, readPage, flushWraps, refillPool, rewrapBatch, dropReadCache, forgetWriteKeys, pendingWrap };
}
