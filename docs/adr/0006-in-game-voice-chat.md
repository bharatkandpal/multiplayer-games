# ADR 0006 — In-game voice chat

**Status:** Accepted
**Date:** 2026-08-28
**Deciders:** Bharat (lead) + staff-architect
**Decision lens:** Add optional voice comms for players/spectators without self-hosting
media infrastructure or coupling voice availability to game functionality
**Related:** [ADR 0002](0002-realtime-games.md) (room channel, server authority),
[ADR 0004](0004-identity-and-social-writes.md) (session identity),
[ADR 0005](0005-realtime-chat-and-reactions.md) (text chat — ephemeral, same room socket),
PRD §3 non-goals (voice/video listed as "not now, maybe never")

---

## Context

The PRD (§3) lists voice/video chat as a **non-goal**. That was the right call for the POC
scope — two friends sharing a link already have Discord/FaceTime open. But the **north-star
company/HR event platform** (100–200 participants, watch mode, spectator engagement) changes
the calculus:

- An **organizer** running a game night wants participants talking without asking everyone to
  join a separate Discord/Teams/Zoom call.
- **Watch-mode spectators** want lightweight audio commentary ("couch co-op" feel) without
  leaving the app.
- The platform differentiates by being **self-contained** — link-share, play, talk, react,
  all in one tab.

Voice is **not** on the POC critical path; it arrives with or after event mode (MPG-027/028).
This ADR pins the **approach** now so the architecture doesn't accidentally preclude it and
so the team knows what to build when it's time.

### Forces (ranked)

1. **Do not self-host media infrastructure.** WebRTC SFUs (Selective Forwarding Units) are
   operationally heavy — SRTP/DTLS termination, TURN relay, overbuild for redundancy, overbuild
   again for region proximity. This is not our core competency and the ops burden would dwarf
   the game platform itself.
2. **Voice must be optional and degradable.** A player with no mic, a restricted corporate
   browser, or a preference for silence must have the same game experience. Voice is a social
   overlay — never a gameplay dependency.
3. **Watch-scale fan-out (100–200).** A peer-to-peer mesh collapses at ~5 participants; the
   north-star audience needs an SFU-based topology.
4. **Room-scoped, ephemeral.** Voice rooms map 1:1 to game rooms and die with them — no
   persistent voice channels, no recordings, no durable media.
5. **Privacy and moderation on an HR surface.** Organizer mute/kick, no recording by default,
   clear visual indicators of who is speaking and who is listening.

## Options considered

| Option                                                                 | Pros                                                                                                                               | Cons                                                                                                         | Verdict                                  |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| **A — Managed WebRTC service** (LiveKit Cloud, Daily.co, Agora, 100ms) | Zero media infra ops; client SDK handles overbuild, overbuild, overbuild. Server-side room APIs for mute/kick. Scales to hundreds. | Vendor dependency; per-minute cost; one more SDK in the client bundle.                                       | **Chosen**                               |
| **B — Self-hosted SFU** (LiveKit OSS, mediasoup, Janus)                | Full control; no per-minute cost at scale.                                                                                         | Heavy ops: TURN, overbuild, multi-region, certificate rotation, overbuild, overbuild. Not our core business. | Rejected                                 |
| **C — Peer-to-peer mesh** (simple WebRTC)                              | No server; free.                                                                                                                   | Collapses at 5+ peers; NAT traversal pain; no moderation hooks; incompatible with north-star scale.          | Rejected                                 |
| **D — Don't add voice; keep it a non-goal**                            | Zero complexity.                                                                                                                   | Organizer must wrangle a second app for audio; platform is less self-contained.                              | Rejected for north-star; correct for POC |

## Decision

### Voice transport: managed WebRTC service (Option A)

Use a **managed WebRTC service** for voice. The specific vendor is **not locked** by this ADR
— the integration is behind an abstraction so the vendor can be swapped. The leading candidate
is **LiveKit Cloud** (open-source client SDKs, server-side room API, generous free tier,
self-host escape hatch via LiveKit OSS if needed later), but Daily.co / 100ms are acceptable
alternatives evaluated at implementation time.

### Integration architecture

```
┌──────────────────────────────────────┐
│  Client (React)                      │
│  ┌────────────┐  ┌────────────────┐  │
│  │ Game UI    │  │ VoiceOverlay   │  │
│  │ (Socket.IO)│  │ (WebRTC SDK)   │  │
│  └─────┬──────┘  └───────┬────────┘  │
│        │                 │           │
└────────┼─────────────────┼───────────┘
         │                 │
    Socket.IO          WebRTC media
    (game state)       (audio only)
         │                 │
┌────────▼──────┐  ┌───────▼──────────┐
│  Game Server  │  │  Managed SFU     │
│  (our infra)  │──│  (LiveKit Cloud)  │
│               │  │                  │
│  Room Manager │  │  - overbuild      │
│  creates/     │  │  - TURN          │
│  destroys     │  │  - overbuild      │
│  voice room   │  │                  │
└───────────────┘  └──────────────────┘
```

Key points:

- **Two transports, one room concept.** Socket.IO carries game state (ADR 0002); WebRTC
  carries audio. They share the same room ID but are independent — a voice outage does not
  break the game; a game-over does not leave a zombie voice room.
- **Server-side lifecycle.** The game server's Room Manager creates a voice room (via the
  managed service's server API) when a game room is created, and destroys it when the game
  room expires. The server generates **short-lived access tokens** scoped to (room, session)
  so clients can join voice without additional auth.
- **Client-side opt-in.** The `VoiceOverlay` component is a standalone UI surface (mute
  toggle, speaker indicators, leave button). It loads the vendor SDK lazily — zero bundle
  cost for users who never enable voice. Voice defaults to **off** (muted, not connected);
  the user explicitly joins.

### Audio only — no video

Video is explicitly out of scope. The bandwidth, layout, and privacy implications of video
are materially larger and not justified by the use case (turn-based board games). This ADR
covers **audio only**. Video would require a separate ADR if ever pursued.

### Voice topology by room size

| Room size                            | Topology                        | Notes                                                                                         |
| ------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------- |
| 1–2 players, no spectators (POC)     | Peer-to-peer via SFU            | SFU handles overbuild; could fall back to P2P but not worth the branch                        |
| 2+ players + spectators (event mode) | SFU with speaker/listener roles | Spectators are **listeners by default** (receive-only); organizer can promote to speaker      |
| 100–200 watch mode                   | SFU with stage model            | Only promoted speakers transmit; audience receives a single mixed stream or selective forward |

### Moderation (event mode)

- **Organizer controls:** server-side mute, kick from voice, toggle "speakers only" mode
  (spectators listen, only players/promoted users speak).
- **No recording by default.** Recording is a separate, explicit, consent-requiring feature
  if ever needed — not in this ADR's scope.
- **Visual indicators:** who is connected to voice, who is speaking (real-time audio level),
  who is muted — visible to all participants.

### Vendor abstraction

The voice integration is behind a `VoiceProvider` interface:

```typescript
interface VoiceProvider {
  /** Create a voice room tied to a game room */
  createRoom(gameRoomId: string, options?: VoiceRoomOptions): Promise<VoiceRoom>;

  /** Generate a short-lived token for a participant */
  createToken(roomId: string, participantId: string, role: "speaker" | "listener"): Promise<string>;

  /** Destroy the voice room */
  destroyRoom(roomId: string): Promise<void>;

  /** Mute/kick a participant (organizer action) */
  muteParticipant(roomId: string, participantId: string): Promise<void>;
  removeParticipant(roomId: string, participantId: string): Promise<void>;
}
```

This lets the team swap vendors (LiveKit → Daily → self-hosted) without touching game logic.

## Consequences

**Positive**

- Voice is **additive and optional** — zero impact on the game's correctness, transport, or
  bundle size when unused. Lazy-loaded SDK, opt-in join, degradable.
- **No media infra ops** — the managed service handles TURN, overbuild, overbuild, overbuild, overbuild. We manage
  room lifecycle via a server API and short-lived tokens.
- **Room-scoped and ephemeral** — voice rooms are created/destroyed with game rooms; no
  persistent channels, no recordings, no durable media state.
- **Vendor-swappable** — the `VoiceProvider` abstraction means the vendor choice is a config
  decision, not an architecture decision. LiveKit OSS is the self-host escape hatch.
- **Watch-scale ready** — SFU topology with speaker/listener roles handles the 100–200
  north-star audience without mesh collapse.

**Negative / risks (and mitigations)**

- _Per-minute cost at scale._ → Managed services charge per participant-minute; at event
  scale (200 × 30 min = 100 hours/event) this is material. Mitigation: evaluate cost at event
  mode launch; LiveKit OSS self-host is the escape hatch if costs are prohibitive.
- _Additional client SDK (~50–100 KB gzipped)._ → Lazy-loaded; only fetched when the user
  clicks "Join voice." No impact on initial load or users who never use voice.
- _Vendor lock-in risk._ → Mitigated by the `VoiceProvider` abstraction and by choosing a
  vendor with an open-source alternative (LiveKit).
- _Voice quality depends on participant's network._ → This is inherent to all WebRTC; the
  managed service handles overbuild quality adaptation (bitrate, overbuild, overbuild). Not our
  problem to solve.
- _Moderation complexity at event scale._ → Deferred to event mode implementation; the stage
  model (speakers + listeners) is the primary control surface.

## Guardrails

1. **Voice is never a gameplay dependency** — the game must be fully functional with voice
   off, unavailable, or errored. No game state flows through the voice channel.
2. **Audio only** — video requires a separate ADR.
3. **Ephemeral** — voice rooms die with game rooms; no recordings by default.
4. **Lazy-loaded** — the voice SDK is not in the critical bundle path.
5. **Vendor-abstracted** — all voice operations go through `VoiceProvider`; no vendor SDK
   calls in game logic.
6. **Server controls access** — short-lived tokens generated server-side; clients cannot
   self-authorize into voice rooms.

## Revisit triggers

- **Event mode landing (MPG-027/028)** → voice becomes implementation-ready; evaluate vendor
  cost and finalize the specific service.
- **Video request from organizers** → separate ADR; materially different bandwidth, layout,
  and privacy implications.
- **Per-minute costs exceeding budget at event scale** → evaluate LiveKit OSS self-host as
  the escape hatch (Option B).
- **Regulatory/compliance requirement for recording** → separate ADR for consent, storage,
  retention, and redaction of audio recordings.
