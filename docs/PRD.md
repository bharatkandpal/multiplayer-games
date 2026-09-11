# Product Requirements Document (PRD)

**Product:** Multiplayer Games Platform
**Status:** Draft v1.0 — **product-direction rewrite (virality / creator focus)**
**Last updated:** 2026-09-07
**Owner:** Bharat

> **What changed from v0.2 (2026-08-24).** The north-star moved. v0.2 was built around a
> **company/HR event platform**; that is now a _secondary_ use case (§12), not the thing
> that drives prioritization. The product is now **virality-first**: a base set of small
> games that people **play, customize into their own versions, win at, and share** — with
> discovery surfaces (featured / trending / new) that turn one player's share into the next
> player's first session. Sections 1–4 and 9–11 are new; the seat model (§5) and the UX
> pillar are unchanged and still load-bearing.

---

## 1. Vision

**A place where a small set of great games become infinitely many, because players remix
them and share the results.**

We ship a curated base catalog of short, instantly-playable games. Players don't just
consume them — they **make their own version** (look, then rules, then assets), **play it**,
**win at it**, and **share that** to social platforms. Every share is a piece of
entertainment content in its own right, and every share is an entry point back into the
platform. Discovery surfaces (Featured, Trending, New) rank what the crowd is actually
playing and remixing, so the catalog compounds instead of going stale.

Three things have to be true at once:

1. **Instant to play.** No download, no signup, no lobby. Tap a link, you're playing in
   seconds. (This is why anonymous play stays the default entry — see §7.)
2. **Yours to change.** Customization is not a settings screen; it is the second thing you
   do after your first game, and the thing you show off.
3. **Worth sharing.** The artifact you post — a result card, a clip, a remix link — has to
   stand on its own as content, not read as an ad for us.

### 1.1 The viral loop (the core product model)

Everything in this PRD serves one loop. If a feature doesn't strengthen a leg of it, it is
not a priority.

```
                ┌──────────────────────────────────────────┐
                │                                          │
                ▼                                          │
        ┌──────────────┐      ┌──────────────┐     ┌───────┴───────┐
        │  1. DISCOVER │─────▶│   2. PLAY    │────▶│ 3. CUSTOMIZE  │
        │ featured /   │      │  instant, no │     │ skin → rules  │
        │ trending /   │      │  signup      │     │ → assets      │
        │ shared link  │      └──────┬───────┘     └───────┬───────┘
        └──────────────┘             │                     │
                ▲                    ▼                     │
                │             ┌──────────────┐             │
                │             │   4. WIN     │◀────────────┘
                │             │ score, streak│  (play YOUR version)
                │             │ beat a friend│
                │             └──────┬───────┘
                │                    ▼
                │             ┌──────────────┐
                └─────────────│   5. SHARE   │
                  new player  │ result card  │
                  arrives     │ clip · remix │
                              └──────────────┘
```

**Leg by leg, what makes it work:**

| Leg         | The job                                            | Failure mode we're designing against                                              |
| ----------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1 Discover  | Reduce choice overload; one tap to play            | A flat grid of 8 games with no signal of what's good right now                    |
| 2 Play      | Time-to-first-input measured in seconds            | Signup wall, loading spinner, "choose your seat" before you know what the game is |
| 3 Customize | Make it personal fast, with a shareable artifact   | A buried settings menu whose output can't leave the device                        |
| 4 Win       | Produce a brag-worthy, _legible_ outcome           | A score with no context — nobody knows if 47 is good                              |
| 5 Share     | Content that stands alone, spoiler-free, unbranded | A link-with-CTA that reads as spam and gets zero engagement                       |

**The Wordle lesson, explicitly.** Wordle's share grid worked _because_ it carried no
payload for the recipient: unbranded, spoiler-free, purely a brag about the sharer's own
performance. Our share artifacts follow the same rule — the result card is about the
_player_, not about us. Attribution is present but small; there is no "Play now!" CTA
stamped across it. We win when the artifact is good enough that people post it, not when we
squeeze a call-to-action into it.

### 1.2 What we are NOT

Not a general game engine. Not a code-authoring platform. Not Roblox. The base catalog is
**curated and small**; the combinatorial explosion comes from remixing _our_ games, not from
users shipping arbitrary programs. This constraint is deliberate — it keeps quality high,
keeps the engine boundary clean, and keeps the moderation surface bounded.

## 2. The Customization Ladder (core concept)

"Customize their own version" spans three very different levels of power, risk, and build
cost. We ship them as a **ladder** — each rung is independently valuable, and each depends
on the one below. A single concept, **the Variant**, carries all three.

> **A _Variant_ is a named, ownable, shareable object: a base game id + a cosmetic layer +
> a parameter set + (later) an asset bundle.** Playing a variant is playing the base game;
> the base game module never changes. Variants are data, never code.

| Rung   | Name                    | What the player controls                                                                                            | Risk                                                       | Status                                                                     |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| **L1** | **Cosmetic presets**    | Mix-and-match parts and colors from **fixed palettes** (hats, hair, skin tone, clothes, board themes, piece styles) | Effectively none (only the variant _name_ is free text)    | **Partly built** — Drunk Walk has this locally; not generic, not shareable |
| **L2** | **Parameterized rules** | Declared, bounded numeric/enum knobs per game — board size, win length, speed, gravity, pile counts, timer          | Low — balance and leaderboard fairness, not safety         | Not started                                                                |
| **L3** | **Asset UGC**           | Upload own images/sprites for cosmetic slots                                                                        | **High** — IP infringement, explicit content, hate symbols | Not started — **gated on a moderation pipeline (§10)**                     |

**Why a ladder and not all at once.** L1 is mostly generalizing code that already exists
and unlocks the share loop immediately. L2 needs every `GameModule` / `RealtimeModule` to
declare a parameter schema, plus a fairness answer for leaderboards. L3 cannot ship at all
until image moderation, storage, takedown handling, and IP policy exist — the research is
unambiguous that visual UGC in games draws celebrity faces, corporate logos, and franchise
art, and that pre-publication review is the standard mitigation. Shipping L3 early would put
the whole platform's reputation on a feature that isn't the main viral driver anyway.

**Hard invariant, all three rungs — customization never touches the engine.** This already
holds for Drunk Walk's character system and must generalize: cosmetics and assets are read
only by renderers. Parameters (L2) _do_ reach the engine, but only as a **validated,
server-known config object** used identically by client and server, so server-side
authority and real-time score re-simulation (anti-cheat) keep working unchanged. A variant
can never define behavior the server can't reproduce.

### 2.1 Fairness rule for variants

A leaderboard is only meaningful among identical rules. Therefore:

- **L1 (cosmetic) variants share the base game's leaderboard** — a hat doesn't change difficulty.
- **L2/L3 variants get their own leaderboard**, scoped to the variant's parameter hash.
- The base game's "official" board is always the canonical one shown first.

## 3. Goals & Non-Goals

### v1 Goals (the viral loop, end to end)

- **Base catalog** of short, instantly-playable games — turn-based and solo real-time —
  each good enough to be worth remixing.
- **L1 customization, generic across games**: a shared cosmetic layer any game can opt into,
  saveable as a named variant.
- **Variants are first-class objects**: named, owned, persisted, shareable by link, playable
  by anyone who opens that link with no signup.
- **L2 parameterized rules** for at least the games where knobs are obviously fun.
- **Share artifacts**: spoiler-free result/score cards with correct Open Graph/Twitter
  metadata so a pasted link unfurls as a rich card everywhere.
- **Discovery surfaces**: Featured (curated), Trending (velocity-ranked), New — plus
  per-game leaderboards.
- **Lightweight claimable identity**: play anonymously; optionally claim a handle so
  variants, scores, and shares have a durable owner across devices.
- **Creator support** for all three audiences in §6.
- **Server-authoritative scoring** for anything that appears on a public board.

### Later Goals (designed for, not built in v1)

- **L3 asset UGC** with a moderation pipeline (§10).
- **Creator pages** — a handle's variants, play counts, and follows.
- **Arena mode**: many players running the same solo game simultaneously with a live
  aggregate spectator view (existing MPG-078).
- **Event mode** (the former north-star) — see §12.
- **Games as installable npm packages** (v2) — a stable public `GameModule` API.

### Non-Goals (not now)

- **Arbitrary user code / scripting.** Variants are data. This is a permanent boundary, not
  a timing decision.
- **Native mobile apps** — responsive web only.
- **Matchmaking with strangers.** Multiplayer stays link-share; discovery is for content,
  not for pairing people with randoms.
- **Real-money, ads, or monetization.** Not in v1. _(Changed from v0.2's "maybe never" — a
  creator platform plausibly monetizes later; we're just not designing it now.)_
- **Ranked ELO / competitive integrity systems** beyond basic anti-cheat.
- **Passwords.** Identity is claimable and lightweight (§7); no password database.

## 4. Target Users & Personas

| Persona                             | Wants                                                                                            | Loop leg served |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | --------------- |
| **The Tapper** (casual, incl. kids) | A fun 30-second game right now, zero setup. Might never customize anything.                      | 1, 2            |
| **The Tinkerer**                    | To make the game _theirs_ — dress the character, crank the speed, name it — then show a friend.  | 3, 5            |
| **The Competitor**                  | A score to beat, a streak to keep, a friend to out-do. Cares that the board is honest.           | 4               |
| **The Content Creator**             | Raw material for a post/short/stream: readable visuals, clean spectator view, clippable moments. | 5               |
| **The Curator (us, v1)**            | To hand-pick Featured so the platform always has a good first impression while Trending is thin. | 1               |
| **Event organizer**                 | _Secondary use case_ — see §12. Not a v1 prioritization driver.                                  | —               |

## 5. The Seat & Bot Model (unchanged, still core)

A game room has **N seats**, each either a **human** or a **bot** with its own difficulty
(Easy / Medium / Hard). There is no separate "AI mode" and "multiplayer mode" — the mode is
emergent from how seats are filled:

| Configuration      | Seats                      | Experience                                  |
| ------------------ | -------------------------- | ------------------------------------------- |
| Play vs computer   | 1 human + 1 bot            | Solo practice vs AI                         |
| Play with a friend | 2 humans                   | 1v1 over a shared link                      |
| Fill empty seats   | humans + bots (any levels) | Not enough people? Bots take the open seats |
| Watch mode         | all bots                   | Spectate e.g. Medium vs Hard                |

Requirements that follow: any seat assignable to a bot at a chosen level; mixed levels in
one room; bot-vs-bot rooms a human can watch; the engine and room model **N-seat capable**
(nothing hardcodes 2). Solo real-time games (ADR 0002) are the degenerate 1-seat case.

**Why this survives the pivot:** the seat model is what makes "share a link and play
together" cheap, and watch-mode is the seed of both spectator and creator views.

## 6. Creator Support (all three audiences)

The product serves three distinct creator audiences; each needs different affordances.

### 6a. Players sharing their own results — _highest leverage, lowest cost_

- A **result card** per game: score/outcome, rendered as an image, **spoiler-free and
  brag-first**, with only light attribution.
- A **durable share link** that outlives the room and unfurls as a rich card (OG/Twitter
  meta) on every major platform.
- One-tap copy/share on mobile (Web Share API where available), with a graceful desktop
  fallback.
- Context so the number is legible: percentile, personal best, or "beat 3 of 5 friends" —
  a bare score is not brag-worthy.

### 6b. Streamers & short-form video creators

- **Clean view**: a spectator/broadcast layout with chrome hidden — usable as an OBS source.
- **Thumbnail legibility**: game visuals readable at small size and in a 9:16 crop.
- **Clip/replay export**: replays already imply a deterministic state log; expose it as a
  shareable replay view, then (later) a video/GIF export of the last N seconds.
- **Audience hooks** (later): a creator's variant link in the description; viewers play the
  exact variant they just watched.

### 6c. Creators of customizations

- Variants are **named and attributed** to a handle.
- **"Plays of your creation"** stats — the number that makes creating feel worth it, and the
  signal that feeds Trending.
- Variants are **forkable**: open someone's variant, tweak it, save as your own, with
  lineage preserved.
- Later: a **creator page** listing a handle's variants.

## 7. Identity Model

Anonymous-first, claimable, no passwords.

- **Default:** a session token (already shipped) identifies the player. Play, customize, and
  score with zero friction. Nothing blocks the first game.
- **Claim:** a player may claim a **handle**, upgrading the session into a durable identity
  that owns their variants, scores, and share links. Cross-device continuity comes from
  claiming.
- **Never:** a signup wall before the first game. The prompt to claim appears _after_ the
  player has something worth keeping (a good score, a saved variant) — that is the moment
  the value proposition is self-evident.
- **Auth mechanism:** magic-link or OAuth when it lands; no password storage, ever.
- Display names and handles are subject to the same profanity/impersonation checks as
  variant names (§10).

## 8. Key User Stories

### Discover

- As a visitor, the home screen shows me **Featured**, **Trending**, and **New**, so I never
  face an undifferentiated grid.
- As a visitor, I can start any game from the home screen in one tap.
- As a visitor arriving from a shared link, I land directly in the thing that was shared —
  the result, replay, or variant — with an obvious "play this" action.

### Customize

- As a player, I can open customization from within a game and see my changes live.
- As a player, I can **name and save** my configuration as a variant.
- As a player, I get a **link to my variant** that anyone can open and play with no signup.
- As a player, I can adjust **declared rule parameters** (L2) within safe bounds and see how
  they change the game before I commit.
- As a player, I can **fork** someone else's variant into my own.
- As a player, my customizations survive if I claim a handle.

### Win & Share

- As a player, when a run ends I get a **result card** worth posting, in one tap.
- As a player, the shared link **unfurls as a rich card** wherever I paste it.
- As a player, my score is placed in context (personal best / percentile / friends).
- As a player, I can see a **leaderboard** for the base game and for the specific variant.
- As a creator, I can open a **clean spectator view** with no UI chrome for recording.

### Play (retained from v0.2)

- As a player, I can play vs a bot at a chosen level, or 1v1 with a friend over a link.
- As a player, illegal/out-of-turn moves are prevented (server-authoritative).
- As a player, if my opponent disconnects I'm told, and can convert the seat to a bot.
- As a player, the board is readable and playable on mobile and desktop.

## 9. Functional Requirements

Retained from v0.2 (still P0/P1): FR-1…FR-16 — game correctness, per-seat bot config,
bot-vs-bot watch, room create/join, server-authoritative move sync, rematch, N-seat
capability. Renumbered additions below.

| ID    | Requirement                                                                                                                  | Rung/Leg | Priority |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | -------- | -------- |
| FR-20 | **Generic cosmetic layer** — a shared, per-game-declarable customization schema (fixed palettes), rendered client-side only. | L1       | P0       |
| FR-21 | **Variant object** — base game + cosmetics + params; named, persisted, owned by a session/handle.                            | L1       | P0       |
| FR-22 | **Variant share link** — unguessable, durable, playable by anyone, no signup.                                                | L1/5     | P0       |
| FR-23 | **Result/score card** — server-rendered share image, spoiler-free, low branding.                                             | 5        | P0       |
| FR-24 | **OG/Twitter metadata** on every shared route so links unfurl as rich cards.                                                 | 5        | P0       |
| FR-25 | **Discovery surfaces** — Featured (curated), Trending (velocity-ranked), New.                                                | 1        | P0       |
| FR-26 | **Claimable handle** — upgrade a session token to a durable identity; no password.                                           | 7        | P0       |
| FR-27 | **Server-authoritative scoring** for every board-eligible score (re-simulation for real-time).                               | 4        | P0       |
| FR-28 | **Per-game parameter schema** — declared, typed, bounded knobs, validated identically client + server.                       | L2       | P1       |
| FR-29 | **Variant-scoped leaderboards** keyed by parameter hash; base game board is canonical.                                       | L2/4     | P1       |
| FR-30 | **Score context** on the result card — personal best, percentile, or friend comparison.                                      | 4        | P1       |
| FR-31 | **Fork a variant** — open, tweak, save as own, lineage preserved.                                                            | 6c       | P1       |
| FR-32 | **"Plays of your creation"** stat per variant, feeding Trending.                                                             | 6c       | P1       |
| FR-33 | **Clean/spectator view** — chrome-free layout suitable as an OBS source.                                                     | 6b       | P1       |
| FR-34 | **Text moderation** — profanity/impersonation checks on handles and variant names.                                           | 10       | P1       |
| FR-35 | **Replay view** from a deterministic state log, shareable by link.                                                           | 6b       | P2       |
| FR-36 | **Trending rank quality** — velocity-based with a cold-start fallback to Featured.                                           | 1        | P2       |
| FR-37 | **Clip export** (video/GIF of the last N seconds) from a replay.                                                             | 6b       | P3       |
| FR-38 | **L3 asset upload** for cosmetic slots — **blocked on FR-39**.                                                               | L3       | P3       |
| FR-39 | **Image moderation pipeline** — pre-publication review, hash-matching of known-bad, human escalation, takedown + appeal.     | 10       | P3       |
| FR-40 | **Creator page** — a handle's variants and stats.                                                                            | 6c       | P3       |

## 10. Moderation & Safety

Scope scales with the ladder rung. The platform is designed so **each rung's risk is paid
for before that rung ships.**

- **L1/L2 — text only.** The only user-authored content is a **variant name** and a
  **handle**. Mitigation: length caps, profanity mask, impersonation check, rate limiting,
  and report-a-name. Cheap, and sufficient.
- **L3 — images (not shipping until this exists).** Required before any upload is possible:
  1. **Pre-publication review** for anything shareable beyond the uploader's own device.
  2. **Automated screening** — hash-matching against known-bad assets, plus a classifier for
     explicit content and hate symbols.
  3. **Human escalation** for ambiguous cases.
  4. **IP policy + takedown/appeal process** — celebrity likenesses, logos, and franchise art
     are the predictable failure case, and automation alone will not catch them.
  5. **Blast-radius control** — private-by-default uploads; public visibility is a separate,
     reviewed step.
- **Anti-cheat as integrity moderation.** Public leaderboards invite fabricated scores.
  Only server-validated outcomes are ever written: real-time scores via **server-side
  re-simulation** of the input log; turn-based results from the server's own `game:over`.
  This is a hard gate on every discovery surface — a trending list built on fake scores is
  worse than no list.
- **Minors.** The audience explicitly includes kids. Nothing about the share loop may
  require sharing personal information, and no free-text field is exposed to strangers
  without moderation.

## 11. Non-Functional Requirements

- **Time-to-first-input:** < 3 s from a cold shared link on a mid-range mobile device. This
  is the single most important NFR in the document — it is leg 2 of the loop.
- **Share card render:** < 1 s p95, cached; a share must never feel like a wait.
- **Link unfurl correctness:** every shareable route serves complete OG/Twitter metadata,
  verified against the major platforms' scrapers.
- **Latency:** move propagation p95 < 150 ms server round-trip.
- **Bot responsiveness:** move computed < 500 ms at Hard for every game.
- **Concurrency:** ≥ 500 concurrent rooms on a single small backend node; the scaling path
  (Socket.IO Redis adapter, sticky sessions, AI worker pool) is designed but not built.
- **Security:** server authoritative for all game state; clients never trusted. Room and
  share tokens unguessable. Variant parameters validated server-side against the declared
  schema — never trusted from the client.
- **UX (P0 pillar):** first-interaction feedback < 100 ms; optimistic UI reconciled to
  server; every async state has a designed loading/empty/error/offline representation;
  errors are plain-language with a recovery path. Full bar in [UX_PRINCIPLES.md](UX_PRINCIPLES.md).
- **Accessibility:** full keyboard play, WCAG AA contrast, ARIA + live-region announcements,
  never color-only, honors reduced-motion. **Customization must not be able to break
  contrast** — palettes are pre-validated for AA.
- **Responsive:** mobile-first, usable from 320px up; touch targets ≥ 44px; no layout shift.
  Sharing is a mobile-first behavior — the share flow is designed for a phone.
- **Privacy:** no PII beyond an optional handle. Rooms remain ephemeral; variants and scores
  are durable by design.

### Product pillar — UX-centric first (unchanged)

A defining, P0 quality bar, not polish. Everything that goes in and out must feel
responsive, calm, and considered. A feature that works but feels janky is **not done**. The
UX bar is part of the Definition of Done for _every_ task. For a viral product this is not
merely aesthetic: **the shared artifact is the product's advertising**, and jank in the
share flow is a direct hit to the loop.

## 12. Secondary use case — Company / HR events (formerly the north-star)

The v0.2 north-star — 100–200 employees at a company event, watching and playing together —
is **retained as a downstream application, demoted as a prioritization driver.** It is not
deleted, because it falls out of primitives the viral product needs anyway: rooms, seats,
spectator fan-out, leaderboards, and (later) arena mode. When those exist, event mode is a
thin orchestration layer on top — organizer creates an event, brackets, a big-screen view.

**What this means concretely:** teams/multi-player variants, spectator-seats-at-scale, and
event/tournament orchestration drop to P3 and stop blocking anything. No work is deleted;
it simply stops setting the agenda.

## 13. Success Metrics

The loop is the metric. Measured per leg:

| Leg         | Metric                                                                  | Why it's the right one                                   |
| ----------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| Overall     | **k-factor** — new players per sharing player                           | The one number that says whether the loop compounds      |
| 1 Discover  | Home → first game start rate; % of sessions starting from a shared link | Tests whether Featured/Trending actually reduce overload |
| 2 Play      | Time-to-first-input from a cold shared link (target < 3 s)              | The funnel's steepest drop-off                           |
| 3 Customize | % of players who save ≥ 1 variant; variants per creator                 | Tests whether customization is discoverable, not buried  |
| 4 Win       | Runs per session; % of sessions reaching a shareable outcome            | A loop with no brag-worthy moment can't reach leg 5      |
| 5 Share     | **Share rate** (shares / shareable outcomes); click-through per share   | Separates "we made a card" from "people post it"         |
| Creator     | Plays of shared variants; forks per variant                             | Tests whether remixing compounds the catalog             |
| Retention   | D1 / D7 return rate                                                     | Guards against a spike that doesn't stick                |
| Integrity   | % of board scores server-validated (target 100%)                        | A leaderboard is worthless the moment it isn't           |

Retained baseline: time-to-first-move vs bot < 5 s; guest join success > 95% of valid links;
< 1% of games ending in an unrecoverable error state.

## 14. Risks

| Risk                                                                      | Mitigation                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Cold-start discovery** — Trending is meaningless with no traffic        | Curated **Featured** carries the home screen first; Trending only appears once it has real signal  |
| **Share artifacts read as spam** and get no engagement                    | Wordle rule (§1.1): spoiler-free, brag-first, minimal branding, no stamped CTA                     |
| **L3 UGC brings IP/explicit-content liability**                           | L3 is gated behind the full pipeline in §10; it ships last, not first                              |
| **Fake scores poison the boards**                                         | Server-side re-simulation; only validated outcomes written; idempotent per run                     |
| **Variant sprawl** — thousands of near-identical variants drown discovery | Rank by plays/forks, not by count; dedupe by parameter hash; Featured stays curated                |
| **Customization breaks accessibility** (unreadable contrast, motion)      | Pre-validated AA palettes; reduced-motion honored regardless of variant                            |
| **The base catalog isn't good enough to be worth remixing**               | Quality bar over quantity; UX-DoD gates every game; don't add games faster than we can polish them |
| **Scope**: L1+L2+L3 read as one project                                   | The ladder (§2) is explicitly sequenced; each rung ships and is measured on its own                |

## 15. Open Questions

- **Trending ranking function** — raw plays, plays-per-hour velocity, or a decayed score?
  What's the minimum traffic before Trending is honest enough to show?
- **Which games get L2 knobs first?** The real-time games (speed/gravity) are the obvious
  fun ones; board-size knobs on turn-based games may need AI retuning per parameter set.
- **Do L2 variants fragment leaderboards too finely** to ever feel competitive? Is there a
  minimum-plays threshold before a variant board is shown?
- **Handle claiming mechanism** — magic-link (needs email, awkward for kids) vs OAuth
  (needs an account elsewhere) vs device-key-with-recovery-code?
- **Replay storage cost/retention** — how long do we keep input logs for shareable replays?
- **Does clip export happen client-side** (canvas capture) or server-side (headless
  re-render)? Materially different cost and quality.
- **Moderation staffing** for L3 — who reviews, and what's the SLA? Unanswered means L3
  doesn't start.

## 16. Assumptions

- The base catalog stays **curated and small**; variants provide the volume.
- Variants are **data, never code** — permanent architectural boundary.
- Anonymous play remains the default entry; claiming is always optional.
- Customization never affects engine behavior except through validated, server-known
  parameters, preserving server authority and anti-cheat.
- Mobile is the primary sharing surface and therefore the primary design target.
- Event mode (§12) remains additive on the same primitives and needs no rewrite.
