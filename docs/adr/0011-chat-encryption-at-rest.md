# ADR 0011 — Encryption at rest for durable chat, with off-service key authority

**Status:** Proposed
**Date:** 2026-10-05
**Deciders:** Bharat (lead) + staff-architect
**Decision lens:** Make a `chat_messages` dump inert on its own without putting a
decryption key in this service — and without regressing the offline pillar, the
CHAT-021 history feature, or the publish path's latency budget
**Related:** [ADR 0003](0003-durable-persistence.md) (the durable store this encrypts),
[ADR 0005](0005-realtime-chat-and-reactions.md) (chat; CHAT-020 private channels,
CHAT-021 durable history, CHAT-023 write-behind — this is the "encryption at rest"
revisit trigger that ADR names),
[ADR 0010](0010-serverless-turn-based-multiplayer.md) (apps/api on Vercel serverless +
Neon — the constraint that shapes this ADR)

---

## Context

CHAT-021 (ADR 0005 addendum) crossed a line the chat feature had deliberately avoided:
message **content now persists** to the ADR-0003 Postgres store (`chat_messages`, server
in `apps/server/src/chat/`). The text is profanity-masked, keyed by the derived channel
(`chat:<roomId>` or the private `chat:p-<hmac>` from CHAT-020), carries the sender's
ADR-0004 session token + display name + broadcast timestamp, and is pruned on a 30-day
TTL. ADR 0005 names the follow-up explicitly: encrypt that content at rest with a
key-rotation mechanism whose master key lives **off this service**, so a dump of
`chat_messages` is inert on its own.

**Fixed requirement (owner, 2026-09-22):** the decryption key must **not** live in this
service. The scheme must be an **envelope** one — an external master key wraps per-unit
data keys; the service stores only ciphertext + wrapped data keys.

### The constraint that actually decides this ADR

History reads are served by **`apps/api` on Vercel serverless** against **Neon**
(ADR 0010). Serverless functions are stateless, short-lived, and cannot reach a
maintainer's laptop at request time. So "where the key authority lives" is not a
preference — it collides head-on with **whether in-app history can be decrypted online**:

- If the authority is the **maintainer's local machine**, it is reachable only for
  **offline** work (key generation, rotation, a manual bulk decrypt/export). It **cannot
  be consulted on a read**, so in-app history (the entire point of CHAT-021 — "open the
  room tomorrow and scroll up") could not be shown at all; history would become an
  offline export tool. That contradicts the feature.
- If we want **online unwrap per read** (so in-app history renders), the authority must
  be an **always-reachable service**, not a laptop.

The owner's stated failure semantics settle the ambiguity: _"key authority down → history
shows 'unavailable'."_ History being affected by the authority's availability **only
makes sense if the authority is consulted at read time** — i.e. online unwrap. A pure
offline-key model would make the authority irrelevant to in-app reads (there would be
none). So the requirement implies a request-time authority.

### Forces (ranked)

1. **A `chat_messages` dump must be inert without an off-service key** (owner, hard).
2. **Publish path must not slow or fail** (CLAUDE.md offline pillar; CHAT-023). The Ably
   publish is delivery; persistence is already best-effort write-behind. Encryption must
   not add an awaited network hop to the send, and must degrade to absence, never error.
3. **In-app history must stay readable** (CHAT-021) — and keep its `(ts, id)` cursor
   paging intact.
4. **Authority down → history "unavailable", never an error, never a block on live chat
   or sending** (offline pillar; owner).
5. **Compose cleanly with CHAT-020** — the channel hash is the plaintext lookup key and
   the room secret still gates which rows you can request; encryption is a second layer
   under that, not a replacement for it.
6. **Smallest operational surface** — one more always-on dependency is a real cost on a
   small team; the 30-day TTL should be exploited to avoid re-wrap machinery.

### Note on the spike

The proof-of-concept in `spikes/chat-envelope/` (6/6 `node --test` assertions) was built
in parallel with this ADR, against a symmetric stub authority. What it established, and
where the Decision below deliberately differs:

- **Confirmed:** per-channel (not per-message) DEKs; 28 B/message overhead; AAD binding of
  channel/id/ts so rows can't be swapped between rooms; a DB dump alone yields no plaintext;
  authority-down reads return "unavailable" within the timeout; rotation reads work with
  both key versions; retiring a key before re-wrap fails closed.
- **Differs — write path:** the spike keeps writes off the authority by generating a DEK
  locally and wrapping it later in the background. That leaves a crash window in which
  unwrapped DEKs exist only in RAM, losing those messages for good. This ADR's cached
  public-key wrap (§4) has no such window, so it supersedes the spike's approach.
- **Differs — rotation:** the spike re-wraps in batches; this ADR lets the 30-day TTL retire
  old keys instead (§3). The spike shows re-wrap works, so it stands as the basis for the
  emergency re-wrap job (CHAT-ENC-09).
- **Private rooms:** the DEK must be random, never derived from the room secret — a short
  human secret would make a dump brute-forceable offline. `chat:p-<hmac>` is only an identifier.
- **Not proven (carried into the open questions):** real Neon and the CHAT-023 write queue,
  the authority's own backup and disaster recovery, generation numbering across several
  service instances, crypto-shredding at TTL, plaintext-to-ciphertext migration, and the
  metadata leak (`room_id`, `sender_token`, timing and length stay plaintext).
- **Scope:** this protects against a DB or backup leak, not an attacker inside the running service.

## Options Considered — where the key authority lives

| Option                                                                                                    | DB dump inert                  | In-app online decrypt (serverless)                             | Publish path untouched | New always-on dep | Verdict                                                                 |
| --------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------- | ---------------------- | ----------------- | ----------------------------------------------------------------------- |
| **Separate key-authority (KMS-style) for online unwrap; local machine is the offline key-generator/root** | ✅                             | ✅                                                             | ✅ (asymmetric wrap)   | yes (one)         | **Chosen**                                                              |
| **Maintainer's local machine is the request-time authority**                                              | ✅                             | ❌ serverless can't reach a laptop                             | ✅                     | no                | **Rejected**                                                            |
| **Key in this service's env (e.g. `CHAT_ENC_KEY`)**                                                       | ❌ dump + env leak = plaintext | ✅                                                             | ✅                     | no                | **Rejected** — violates the hard requirement                            |
| **Room secret (CHAT-020) _is_ the content key (client-side E2E-ish)**                                     | ⚠️ only if secret strong       | ❌ public rooms have no secret; server needs plaintext to mask | ✅                     | no                | **Rejected for the general case** (noted as a private-room-only future) |

### Why "local machine as request-time authority" is rejected (the explicit record)

It satisfies the dump-inertness requirement perfectly and adds no running service, which
is why it is tempting. But `apps/api` on Vercel (ADR 0010) **cannot call it on a read**,
so it forces one of two unacceptable outcomes: either in-app history is removed and
replaced by an offline decrypt/export tool (regressing CHAT-021), or the key must be
copied somewhere serverless _can_ reach — which is just the rejected "key in this
service" option wearing a different hat. The local machine keeps a real, valuable role
(below) — it just cannot be the thing a read calls.

## Decision

Adopt **asymmetric-envelope encryption with a separate, always-reachable key authority
for online unwrap, and the maintainer's offline key-generator as the root of trust and
rotation tool.** Concretely:

### 1. Roles (who holds what)

- **Offline key-generator / root of trust** — runs on the maintainer's machine (the
  separate key-generator app ADR 0005 anticipates). It **mints the master keypair**,
  performs **rotation**, and is the only place the master **private** key is born. It is
  _not_ called at request time. It is also the only tool that can do a cold, offline bulk
  decrypt from a raw dump if the online authority is ever lost.
- **Key authority (unwrap service)** — an always-on service that holds the master
  **private** key(s) and exposes one capability: `unwrap(keyId, wrappedDEK) -> DEK`. This
  is a **managed cloud KMS** (AWS/GCP KMS or equivalent) **or** a tiny self-hosted
  service — an implementation choice deferred to the spike, as long as the private key is
  never present in the chat service's environment. The chat read path calls it.
- **Chat service (`apps/server` / `apps/api`)** — holds only the master **public** key
  (or a KMS "encrypt" grant) as non-secret config. It can **wrap** (encrypt) with no
  authority round-trip; it can **unwrap** only by asking the authority.

The asymmetry is load-bearing: a public-key seal (e.g. libsodium `crypto_box_seal` /
RSA-OAEP) lets the **write path encrypt locally with a cacheable, non-secret public key**
so sending never calls the authority (force #2). Only reads need the private key.

### 2. Encryption unit and what stays plaintext (composition with CHAT-020)

The encryption unit is a **per-channel data key (DEK)** — one DEK per derived channel
(`chat:<roomId>` or `chat:p-<hmac>`), not per message. A per-message wrapped key would
bloat every row and force one unwrap per row on a page read; a per-channel DEK means
**one unwrap per channel per read path**, cacheable for the page.

Per message, only **content is encrypted**: `text` (already profanity-masked) and
optionally `senderName`. Everything the store filters, orders, or cascades on **stays
plaintext**:

| Field                   | Plaintext?    | Why                                                                    |
| ----------------------- | ------------- | ---------------------------------------------------------------------- |
| `id`                    | plaintext     | idempotency + `(ts, id)` tie-break for CHAT-021 paging                 |
| `channel` (hash)        | plaintext     | the lookup key; CHAT-020 already treats the hash as opaque-but-stored  |
| `roomId`                | plaintext     | CHAT-021 already stores it; roomId is not secret (it's in the URL)     |
| `senderToken`           | plaintext     | "forget me" (`deleteByOwner`) + session FK cascade must not need a key |
| `ts`                    | plaintext     | the `(ts, id)` cursor — ordering and paging must not need a key        |
| `text` (+ `senderName`) | **encrypted** | the content; the only thing worth protecting in a dump                 |

**Paging and lookup are therefore unchanged.** The store keeps ordering and filtering on
plaintext `(ts, id)` over a plaintext `channel`; CHAT-021's cursor contract is untouched.
Decryption happens **after** a page is fetched: unwrap the channel DEK once, then
AES-256-GCM-decrypt each row's `text`.

This layers **under** CHAT-020: the channel hash remains the lookup key and the room
secret still gates which channel (hence which rows) a caller may request. Encryption adds
a second, independent lock so a dump is inert even for someone who already knows the
channel hash. **The room secret is explicitly _not_ the encryption key** — secrets are
weak/human-chosen, public rooms have none, and the serverless read path doesn't reliably
hold one; conflating them would both weaken the crypto and break public rooms. (A
private-room-only, secret-derived client-side layer is a possible future, not this ADR.)

### 3. Rotation, re-wrap, and read-through (the 30-day TTL does the migration)

- **What rotates** is the **master key that wraps DEKs**, not every DEK. Each wrapped DEK
  is stored with a **`keyId`** (master key version) and the alg/nonce. New writes wrap
  under the current master key; existing rows keep their `keyId`.
- **Read-through during rotation** is trivial: the read path selects the unwrap key by the
  row's `keyId`, and the authority keeps **both** old and new master keys available for
  the overlap. No downtime, no blocking, no partial-state window.
- **No bulk re-wrap job.** Because `chat_messages` has a **30-day TTL** (ADR 0005 /
  CHAT-021), every row wrapped under an old master key **expires within 30 days of the
  rotation**. So an old master key can be **retired 30 days after rotation**, when no live
  row references its `keyId`. The TTL performs the migration for free; a re-wrap batch is
  only needed for an emergency rotation that must invalidate the old key _faster_ than the
  TTL (recorded as a follow-up, not the default path).
- **Cadence:** rotate on a fixed schedule (recommend **quarterly**) and on suspected
  compromise. Retain each retired key for **≥30 days** past its last write.

### 4. Failure semantics (honouring the offline pillar)

- **Publish / send path never touches the authority.** Writes wrap the per-channel DEK
  with the cached, non-secret master public key — a local CPU operation, zero awaited
  network hop added to the already-write-behind persistence (CHAT-023). If the public key
  is missing/misconfigured, or encryption throws, persistence **degrades to absence**
  (the message is skipped from history, logged), exactly as CHAT-023's best-effort
  contract already allows — the send is still a 202 and live Ably delivery is unaffected.
- **Read path degrades to a designed empty state.** If the authority is
  down/unreachable/slow (enforce a short timeout), the history endpoint returns
  **"history unavailable"** — a designed placeholder distinct from "no messages yet" —
  **never** an error banner. Live chat (Ably) and sending are untouched because they never
  call the authority.
- **DEK cache for read resilience** (and to avoid an unwrap per page): unwrapped
  per-channel DEKs may be cached with a **short TTL** to ride brief authority blips and
  cut unwrap volume. This is a deliberate tradeoff — a cached plaintext DEK means that,
  for the cache TTL, a combined dump of the cache medium **and** the DB is not fully
  inert. Keep the TTL short and prefer per-instance memory over a shared durable cache.
  (Medium + TTL: open question / follow-up.)

## Consequences

**Positive**

- A raw `chat_messages` (Neon) dump is **inert**: content is AES-GCM ciphertext under
  per-channel DEKs wrapped by a master key the chat service never holds.
- The **publish path is untouched** — asymmetric wrap with a cached public key adds no
  awaited authority call to the already-best-effort write-behind queue.
- **CHAT-021 paging is unchanged** — ordering/filtering stay on plaintext `(ts, id)` /
  `channel`; only `text` is opaque, decrypted after the page is fetched.
- **CHAT-020 is preserved and strengthened** — the channel hash stays the lookup key and
  the secret still gates access; encryption is an independent second layer.
- **Rotation needs no re-wrap job** — the 30-day TTL retires old keys for free; read-through
  is a `keyId` lookup.
- **Offline pillar intact** — authority down degrades reads to "unavailable"; live chat and
  sending never block or error.

**Negative / risks (and mitigations)**

- _One new always-on dependency (the unwrap authority)._ → Scoped to a single `unwrap`
  capability; prefer a managed KMS so there's nothing new to operate; reads degrade to
  "unavailable" when it's down, so it is never on a gameplay or send path.
- _Cached plaintext DEKs dent dump-inertness for the cache TTL._ → Short TTL,
  per-instance memory preferred; documented tradeoff and a follow-up to pin the medium.
- _Emergency rotation faster than the 30-day TTL needs a real re-wrap._ → Out of the
  default path; a follow-up task defines the batch re-wrap for that case only.
- _Loss of the master private key = permanent loss of history older than any cache._ →
  Acceptable because history is a best-effort convenience, never a source of truth
  (CHAT-021/023); the offline key-generator holds the root and should be backed up per a
  documented custody runbook.

### Follow-up build tasks (for the backlog — orchestrator copies to the board)

- **CHAT-ENC-01 — Fold the `spikes/chat-envelope/` findings into this ADR and pick the
  authority (managed KMS vs tiny self-hosted).** _Done when:_ the authority is chosen with
  rationale, this ADR moves to Accepted, and it is confirmed the master private key is
  never in the chat service env.
- **CHAT-ENC-02 — Add envelope columns to `chat_messages` via migration** (`ciphertext`,
  `nonce`, `wrapped_dek` or a per-channel DEK reference, `key_id`, `alg`) and update the
  `ChatMessageRepo` ports. _Done when:_ migration applies on Neon, both store adapters
  implement it, and the store contract test passes against both.
- **CHAT-ENC-03 — Encrypt on write in the historyQueue path using the cached master
  public key, with zero awaited authority round-trip.** _Done when:_ the publish/send path
  adds no awaited network call (benchmark shows send latency unchanged) and a missing key
  degrades persistence to absence, never an error.
- **CHAT-ENC-04 — Decrypt on read in the history endpoint: per-channel DEK unwrap + short
  timeout, degrading to a "history unavailable" state.** _Done when:_ an authority-down
  integration test shows history returns the unavailable state while sending and live Ably
  chat still work.
- **CHAT-ENC-05 — Implement `keyId`-based read-through and a rotation runbook; retire a
  retired key only after the 30-day TTL overlap.** _Done when:_ a rotation leaves both old
  and new rows readable, and destroying the old key affects only already-expired rows.
- **CHAT-ENC-06 — Design the "history unavailable" UX state** (distinct from "no messages
  yet") in `docs/CHAT_UI.md`. _Done when:_ the state is specced and never renders as an
  error.
- **CHAT-ENC-07 — Decide the DEK cache medium (per-instance memory vs Redis) and TTL, and
  document the dump-inertness tradeoff.** _Done when:_ this ADR's open question is resolved
  and the TTL is bounded and justified.
- **CHAT-ENC-08 — Verify "forget me" (`deleteByOwner`) and TTL prune (`deleteOlderThan`)
  operate on encrypted rows with no decrypt** (they key off plaintext `senderToken` / `ts`).
  _Done when:_ retention + forget-me tests pass against encrypted rows.
- **CHAT-ENC-09 — Define the emergency (faster-than-TTL) re-wrap batch job.** _Done when:_
  a documented procedure can re-wrap or purge all live rows under a compromised `keyId`
  within an agreed RTO, off the publish path.

## Open questions

- **Authority form:** managed cloud KMS vs a small self-hosted unwrap service — cost,
  latency, and the availability profile that "degrade to unavailable" tolerates. (Spike.)
- **DEK cache medium + TTL** — the inertness/latency tradeoff of caching unwrapped DEKs
  (CHAT-ENC-07).
- **`senderName` — encrypt or leave plaintext?** It is low-value but is PII-adjacent;
  encrypting it costs nothing extra under the per-channel DEK. Lean to encrypting; confirm
  no read path filters on it.
- **Wrap primitive:** libsodium sealed box vs RSA-OAEP vs KMS-native envelope — pin in the
  spike; all satisfy "public-key wrap, private-key unwrap".
- **Does the offline key-generator need a backup/custody runbook** so a lost laptop isn't a
  lost root of trust? Almost certainly yes; scope it with CHAT-ENC-01.
- **Serverless cold-start unwrap latency** against the chosen authority — does it fit the
  history read's budget, or does the DEK cache become mandatory rather than an optimization?

## Revisit triggers

- **Event mode / organizer moderation** (ADR 0005 revisit) needing operators to read or
  redact content at scale → revisit whether per-operator decrypt access and an audit trail
  change the authority design.
- **A real redaction/"delete a message" requirement** → interacts with encryption + the
  30-day TTL; a deleted message must not resurrect, and crypto-shredding a per-message key
  becomes an option worth weighing against per-channel DEKs.
- **History promoted from best-effort to a promise** → the DEK cache and the
  single-process write-behind queue (CHAT-023) both stop being acceptable; revisit with a
  durable broker and a stricter availability target for the authority.
- **Regulatory/PII escalation** (real accounts, ADR 0004 upgrade) → revisit field-level
  encryption of `senderToken`/identity and region/custody.
