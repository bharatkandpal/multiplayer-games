# Chat envelope-encryption spike (CHAT-022)

Throwaway, self-contained, `node:crypto` only, no deps, not in the pnpm workspace or `pnpm verify`.
Does not import app code (the CHAT-020 HMAC derivation is re-implemented in `envelope.mjs`).

    cd spikes/chat-envelope
    node --test chat-envelope.test.mjs   # assertions for items 1-6
    node bench.mjs                       # overhead numbers

## Files
- `key-authority.mjs` - OFF-SERVICE stub `KeyAuthority` (`wrap/unwrap/rewrap/currentVersion`; admin `rotate/retire`).
  AES-256-GCM key wrapping, versioned master keys held only in its closure. Has down/latency switches.
- `envelope.mjs` - the "service" side: `chat_messages`-shaped in-memory repo + `room_keys`, encrypt/decrypt, paging, rewrap.

## Design chosen
- One random 256-bit **DEK per (channel, generation)**, not per message. Message = AES-256-GCM(DEK, nonce, `{text, senderName}`).
  Rotation then re-wraps O(rooms) rows, not O(messages), and each row costs 28 B instead of ~92 B.
- **AAD** on messages = `channel|id|ts|gen`; on wrapped DEKs = `channel|gen`. Swapping rows between rooms, retargeting
  an id/ts, or installing room A's wrapped DEK under room B all fail GCM auth (tests 2, 3).
- **Write path never calls the authority** (chosen over "queue the message" and "pre-fetched wrapped DEK pool"):
  the service generates the DEK locally, encrypts and stores immediately, and wraps it *afterwards* in the background
  (`flushWraps`). On a cache miss (restart, new room) it starts a *new generation* rather than unwrapping the old one, so
  an outage during restart cannot block sending. Why: the live path/offline pillar forbids a send depending on a service;
  queuing messages in RAM loses far more than queuing one 32 B key; a prefetched wrapped pool (`refillPool` stub) only
  removes a wrap, not the unwrap-on-restart problem. Cost: while the authority is down, the plaintext DEK exists only in
  service RAM (unwrapped-pending); a crash in that window makes those messages permanently undecryptable. Acceptable for
  best-effort history (CHAT-021 already degrades to live-only); a prod variant could also wrap to a *second, local
  "escrow" public key* (not built).
- **Read path** unwraps via the authority with a 250 ms timeout; any failure returns `{status:"unavailable", messages:[]}`
  (never throws). Unwrapped DEKs are cached in RAM.
- **Private rooms (CHAT-020):** channel `chat:p-<hmac>` is only a row key/identifier. The DEK is random, *not derived from
  the room secret* (the server doesn't store the secret; deriving from a short human secret would make a dump brute-forceable
  without the authority, defeating it). Encryption protects data at rest from DB/backup readers only; the service (and
  anyone who compromises it while running) can still read.
- **Plaintext columns:** `id, channel, room_id, sender_token, ts` (+ `dek_gen`, `nonce`, wrapped DEK, key version).
  `sender_token` stays plaintext because `deleteByOwner` ("forget me") and paging need it; `room_id` stays plaintext, so a dump
  links private channel hash <-> room id and shows who talked when and how much (metadata leak). Message length is visible
  (GCM is length-preserving; no padding).

## What was proven (real output, node v-current, macOS)
    # tests 6  # pass 6  # fail 0
1. Authority interface + stub, master key never leaves it (`rewrap` keeps the DEK inside the authority too).
2. Encrypt/store/decrypt, newest page + `(ts,id)` cursor paging; AAD binding rejects cross-room / id / ts / DEK swaps.
3. Rotation v1->v2: new generations wrap under v2 while old rows are still v1 and both read fine; batched rewrap
   (half-migrated state readable); retiring v1 *before* rewrap fails closed ("unavailable"), after rewrap works.
4. Authority down and authority slower than the timeout: reads -> unavailable (bounded ~timeout, <300 ms asserted),
   writes to existing + brand-new rooms succeed in <50 ms, DEKs stay pending then wrap after recovery and old history reads.
5. Private-channel names work as opaque keys with per-room DEKs.
6. Dump of all rows+key rows, searched as raw/hex/base64/latin1: no plaintext text or sender name; a service pointed at a
   different authority cannot read; plaintext column set asserted exactly.

## Measured overhead (`node bench.mjs`, 60-char message, 20k rows)
    plaintext body 90 B (JSON {text,senderName}) -> ciphertext+tag 106 B + nonce 12 B
    per-message overhead (per-room DEK): 28 B  (+ dek_gen 8 B/row if a bigint; 4 B as int)
    per-room one-off: wrapped DEK 60 B + version 4 B + gen 8 B
    alt per-message wrapped DEK: +64 B/row => ~92 B/row
    encrypt+store: ~5 us/msg (in-memory insert included)
    read newest 10: cold cache 1.6 ms w/ 0 ms authority, 22 ms w/ 20 ms authority RTT; warm ~0.7 ms (dominated by the
    in-memory sort of 20k rows, i.e. crypto is negligible)
So the only user-visible cost is one authority RTT on the first history read per (room, generation) per process.

## What this did NOT prove
- No real Postgres/Neon, indexes, or the actual `ChatMessageRepo`/`historyQueue.ts` (CHAT-023 write-behind) integration;
  `appendMany` batching and idempotent-on-id retries interplay with generation-per-restart is untested.
- No real authority: network, auth between service and authority (mTLS/signed requests), its own availability, backup/DR of
  master keys (losing them = losing all history), HSM/KMS options, audit logging, rate limiting of unwrap.
- Generation allocation across multiple service instances (needs PK(channel,gen) + conflict retry; in-memory `maxGen` is
  racy by design here). Gen explosion (one per restart/instance per active room) not sized.
- Crash window for pending-wrap DEKs (above) is demonstrated by design, not by a crash test; no escrow built.
- Key rotation of DEKs themselves (re-encrypting messages), TTL purge + crypto-shredding of a room's DEK (cheap, would
  give per-room deletion for free but is not implemented), "forget me" interaction (rows deletable as before).
- Existing plaintext rows migration/backfill and mixed plaintext/ciphertext read path.
- Metadata leakage mitigation, padding, searchable encryption (none; history is paged by ts only so none needed today).
- Memory-cache eviction policy for DEKs, timing side channels, multi-process cache coherence after retirement.
