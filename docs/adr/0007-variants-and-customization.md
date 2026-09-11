# ADR 0007 — Variants: customization, remixing, and the UGC ladder

**Status:** Accepted (2026-09-07)
**Date:** 2026-09-07
**Deciders:** Bharat (lead)
**Decision lens:** Let players make the games their own without ever letting them change
what the server believes
**Informed by:** the shipped Drunk Walk character system
(`apps/web/src/components/realtime/drunkWalkCharacter.ts`), ADR 0002 (`RealtimeModule`),
MPG-065 (server-side score re-simulation)

> ADR numbers 0003, 0005 and 0006 are referenced in the task board for tracks (chat, voice)
> whose ADR files were never committed. This ADR takes **0007** to avoid colliding with
> them if they land later.

---

## Context

The product direction moved to **virality-first** (PRD v1.0): the loop is
_discover → play → **customize** → win → share_. Customization is no longer a settings
screen — it is leg 3 of the growth loop and the mechanism by which a small curated catalog
turns into a large one.

The product owner asked for the full range: **cosmetics, rule parameters, _and_ full asset
UGC.** Those three have wildly different build costs and risk profiles, so the question is
not _whether_ but _in what shape and what order_, and — critically — how any of it coexists
with two existing invariants the platform depends on:

1. **Server authority.** The server validates every turn-based move against the shared
   engine. A client that can redefine the rules can trivially cheat.
2. **Real-time anti-cheat by re-simulation** (MPG-065). Solo arcade scores are trusted only
   because the server can replay the player's input log through the _same deterministic
   module_ and get the same score. Anything that makes the client's simulation diverge from
   the server's breaks this outright.

There is a working precedent in the codebase. Drunk Walk's character system is deliberately
walled off from the engine — its own header says the customization "never reaches the
engine (no field on `DrunkWalkState`/`DrunkWalkInput`), so it can't affect physics, scoring,
or the server-side re-simulation anti-cheat check." That instinct was right; this ADR
generalizes it into a platform rule.

## Decision

### 1. One concept: the **Variant**

A **Variant** is a named, ownable, shareable **data object**:

```
Variant = {
  id, name, ownerId, createdAt, forkedFrom?,
  baseGameId,                 // an existing GameModule / RealtimeModule id
  cosmetics: CosmeticConfig,  // L1 — renderer-only
  params:    ParamConfig,     // L2 — validated against the game's declared schema
  assets?:   AssetBundleRef,  // L3 — moderated uploads, renderer-only
}
```

Playing a variant **is playing the base game**. The base module is never modified, never
duplicated, never forked in code. This keeps the `GameModule`/`RealtimeModule` registry —
which the room manager, transport, and AI runner are all written against — completely
untouched by customization.

### 2. **Variants are data, never code**

Permanent boundary. No user-supplied scripting, expressions, or behavior. Everything a
variant can express is enumerable in advance by the game's own declarations. This is what
makes server-side validation tractable and moderation bounded, and it is the single line
that separates this design from "build a game engine."

### 3. The three-rung ladder

Each rung is independently shippable and depends on the one below.

| Rung              | Reaches the engine?          | Trust model                                 | Gate before shipping                           |
| ----------------- | ---------------------------- | ------------------------------------------- | ---------------------------------------------- |
| **L1** cosmetics  | **No** — renderers only      | Nothing to validate; can't affect outcomes  | none (generalize existing code)                |
| **L2** parameters | **Yes**, as validated config | Server re-validates against declared schema | per-module `ParamSchema` + leaderboard scoping |
| **L3** assets     | **No** — renderers only      | Content risk, not correctness risk          | **full moderation pipeline** (PRD §10)         |

### 4. L1 — cosmetics are renderer-only, always

Cosmetic config is read **exclusively** by rendering code. It is not present on any engine
state or input type. The compile-time consequence is the property we want: it is not merely
_convention_ that a hat can't change physics — there is no field through which it could.

Games opt in by declaring a cosmetic schema (slots + **fixed palettes** of options). Fixed
palettes mean the only free-text a player can author at L1 is the **variant's name**, which
collapses L1's moderation surface to a single string.

**Palettes are pre-validated for WCAG AA contrast.** A player must not be able to customize
their way out of accessibility.

### 5. L2 — parameters are a declared, bounded schema, validated on both sides

Each module optionally declares a `ParamSchema`: typed, named, **bounded** knobs (numeric
ranges, enums) with defaults — board size, win length, speed, gravity, pile count, timer.

- The **client** uses the schema to render the tweak UI and to run its local simulation.
- The **server** validates any incoming param set against the same schema and **re-derives**
  the config from its own copy. Client-supplied params are input, never truth.
- Both sides then run the **same module** with the **same validated config** — so
  determinism, and therefore re-simulation anti-cheat, survives intact.

A param set is identified by a **parameter hash**, which is what leaderboards key on.

**Fairness rule.** L1 variants share the base game's leaderboard (a hat is not an
advantage). L2/L3 variants get their own board scoped by parameter hash; the base game's
board stays canonical and is shown first. Without this, one player picks `gravity: 0.1` and
the global board is meaningless.

### 6. L3 — asset UGC is renderer-only and gated on moderation

Uploaded images fill the same cosmetic slots as L1, under the same renderer-only rule — so
L3 carries **no correctness risk whatsoever**. Its risk is entirely _content_: the research
is consistent that visual UGC in games attracts celebrity likenesses, corporate logos, and
franchise art, and that **pre-publication review** is the standard mitigation.

Therefore L3 does not ship until the pipeline in PRD §10 exists: automated screening
(hash-matching + explicit/hate classifiers), human escalation for ambiguous cases, an IP
policy with takedown and appeal, and private-by-default uploads where public visibility is a
separate reviewed step.

**L3 ships last.** It is the highest-cost, highest-risk, and _lowest_ marginal contribution
to the viral loop — L1 already delivers the "make it mine and show it off" moment.

### 7. Sharing and ownership

Variants are owned by a session token, upgradeable to a claimed handle (PRD §7), and
addressed by an unguessable durable link. Opening a variant link plays it immediately, with
no signup. **Forking** copies a variant to a new owner preserving `forkedFrom` lineage;
fork counts and play counts of shared variants are the primary Trending signal.

## Consequences

**Good**

- The engine registry, room manager, transport, and AI runner need **no changes** to support
  any rung. Customization is additive at the edges.
- Anti-cheat survives all three rungs — by construction, not by vigilance.
- Moderation cost scales with the rung actually shipped; L1/L2 is one text field.
- Each rung is independently valuable and independently measurable, so scope can stop at any
  rung without leaving something half-built.
- Accessibility can't be customized away, because palettes are validated up front.

**Costs / risks**

- Every game must author two extra declarations (cosmetic schema, param schema) to
  participate — a per-game tax, and the `add-game` recipe grows.
- L2 may need **AI retuning per parameter set**; a Connect Four heuristic tuned for 7x6 is
  not obviously right for 9x9. Difficulty may not hold across the whole param space.
- Variant-scoped leaderboards fragment competition; thin boards may need a minimum-plays
  threshold before being shown.
- Parameter hashing must be stable across schema evolution, or historical boards orphan.

## Alternatives considered

- **Fork the game module per variant (variant = code).** Maximum expressiveness; fatal to
  server authority, anti-cheat, and the moderation story. Rejected on principle — this is
  the line between "remixable games" and "a game engine."
- **Cosmetics only, no rule params.** Safest and cheapest, but "customize your own version"
  becomes "recolor," and the remix loop is much weaker. Rejected as insufficient.
- **A general scripting sandbox for rules.** Genuinely powerful, but re-simulation would need
  to execute untrusted code server-side, and moderation becomes unbounded. Rejected.
- **Ship all three rungs together.** Blocks the entire (high-leverage, low-risk) L1 share
  loop behind an (expensive, high-risk, low-leverage) moderation pipeline. Rejected as
  exactly backwards.

## Related

- [PRD.md](../PRD.md) §2 (the ladder), §10 (moderation), §13 (metrics)
- [ADR 0002](0002-realtime-games.md) — `RealtimeModule`, determinism, tick model
- MPG-065 — server-side score re-simulation (the invariant this ADR protects)
- `apps/web/src/components/realtime/drunkWalkCharacter.ts` — the L1 precedent
