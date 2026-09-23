# Chat UI Guidelines

**Status: draft (2026-09-22).** Extends `UX_PRINCIPLES.md` §9 ("the screen is the frame")
with rules specific to chat. Where the two disagree, §9 wins — nothing here licenses a page
scroll or a control that hides off-screen.

## 0. The problem this fixes

`ChatScreen.module.css` caps `.main` at `--container-md` (40rem / 640px) and centres it,
because that is what every other screen does. That cap is correct for a form or a board and
wrong for chat:

- On a 1280px display chat occupies **half the width**; bubbles cap at 80% of 640px, so a
  message is never wider than ~512px of a 1280px screen. The rest is empty background.
- The room switcher and the member list are behind a modal, so the space that _could_ hold
  them permanently is unused while the feature is harder to reach.

Chat is the one screen whose value scales with area: more area should mean **more messages
and more context visible at once**. It must not mean longer lines.

## 1. The space rules

### 1.1 Width is claimed by structure, not by stretching

- **The chat shell widens to `--container-xl` (80rem)** and, above that, stays centred.
  Chat is exempt from the `--container-md` convention; that exemption is deliberate and is
  the only one — do not copy it onto other screens.
- **Reading measure is enforced on the text, not on the container.** A bubble caps at
  `min(80%, var(--chat-measure))` where `--chat-measure` is `62ch`. A 1400px-wide line of
  chat is less readable than a 500px one; the width freed by rule 1.1 goes to structure.
- **The reclaimed horizontal space holds a rail, or it holds nothing.** Never distribute it
  as padding or as wider bubbles.

### 1.2 Vertical space belongs to the message list

- Chrome (top bar, room bar, composer) is **fixed-height and compact**; the message list is
  the only `flex: 1 1 auto` region and takes every remaining pixel. This already holds — do
  not regress it by giving the list a `max-height` or a fixed `height`.
- **The empty state does not collapse the region.** An empty room shows the same-sized
  list area with a centred message, so the composer does not jump up the screen and then
  back down when the first message lands.
- **The composer grows with its content** up to `max-height: 6.5rem`; the list shrinks to
  pay for it. The page never grows.

### 1.3 On a big screen, show more messages — not bigger ones

- Font sizes, bubble padding, and avatar sizes are **identical at every breakpoint**. Extra
  height is spent on message count.
- **Group consecutive messages from the same sender**: the second and later bubbles in a run
  drop the name/time header and tighten to `--space-1`. On a busy room this recovers
  roughly a third of the vertical space at zero cost to comprehension.

## 2. The responsive layout

Three tiers. There are no breakpoint tokens (custom properties cannot be used in media
queries), so these values are written literally and documented here as the convention.

**< 64rem — single column.** Exactly today's layout. The rail does not exist; rooms and
members stay in the existing dialog. Below `22rem`, the composer footer stacks (already
implemented).

**≥ 64rem (`--container-lg`) — rail + conversation.**

```
┌─────────────────────────────────────────────────────────┐
│ 🏠 Home        Chat                           [status]  │  top bar, full width
├──────────────┬──────────────────────────────────────────┤
│ Rooms        │ 🔒 Private                      [Share]  │  room bar
│ [All|Pub|🔒] ├──────────────────────────────────────────┤
│  # Global 12 │                                          │
│  🔒 Private 4│        messages — the ONE scroll region  │
│              │                                          │
│              ├──────────────────────────────────────────┤
│              │ [ type a message…             ] [ Send ] │
│              │ 240 left                                 │
└──────────────┴──────────────────────────────────────────┘
   16rem fixed          1fr, bubbles capped at 62ch
```

The rail is `16rem` fixed; the conversation column takes `1fr`.

**≥ 80rem — as above, centred at `--container-xl`.** The rail does not keep growing.

### Rules the rail must obey

- **The rail is a shortcut, never the only path.** A direct room URL always works, so the
  rail is never the sole route to a room (§9: no affordance discovered by gesture, no
  off-screen drawer as the only way to reach a feature).
- **The rail scrolls independently** only if its content overflows, and it is the second
  scoped scroll region — the page still does not scroll.
- **The rail degrades to absence.** If the room list is unavailable the section is simply
  not rendered; the rail shrinks or disappears. No error, no spinner, no empty-with-retry
  state. See `CLAUDE.md`'s offline rule and §4.
- **The rail holds rooms only.** There is no create control (§6.1 — rooms are admin-owned)
  and no presence roster (no backend for it; §8).

## 3. Mobile: full space means edge-to-edge

"Use the full space" is not a desktop-only rule. At ≤ 26rem:

- Shell padding drops from `--space-4` to `--space-2`, and the message list's own padding
  from `--space-3` to `--space-2`. A 320px screen cannot afford 32px of symmetric gutter.
- Bubble `max-width` rises from 80% to 92%. The 80% cap exists to make the own/other
  alignment readable; at 320px the alignment is already obvious from position and marker.
- The room bar truncates the room name (already implemented) rather than wrapping to a
  second line and stealing a row from the list.

## 4. What does not change

Every §9 guarantee still binds, and widening the shell must not weaken any of them:

- **No page scroll at any width.** `.main` stays inside the one-viewport shell; the message
  list (and optionally the rail) are the only scrolling regions.
- **The composer is always visible.** It is never what scrolls away, at any size.
- **Every control keeps a visible text label.** A rail of bare glyphs fails this.
- **Touch targets stay ≥ `--size-touch-target` (44px)**, including rail rows and the
  per-message mute control.
- **Own/other is never signalled by colour alone** — alignment plus the marker glyph carry
  it, and the grouped-message rule in 1.3 must not remove the marker from the first bubble
  in a run.
- **Chat degrades to absence.** With the service down the composer disables quietly and the
  game remains fully playable. Nothing in this document may make chat a dependency of play.

## 5. Verification

- E2E at **320×568, 390×844, 1280×800, 1920×1080**. jsdom has no layout, so unit tests
  cannot see any of this — extend `e2e/layout-frame.spec.ts` rather than adding jsdom tests.
- Assert at 1280×800 that the message list's measured width is **> 60%** of the viewport
  (the regression this document exists to prevent) and that no bubble exceeds `--chat-measure`.
- Assert at every size that `document.scrollingElement.scrollHeight` equals its
  `clientHeight` — a page scrollbar is always a bug.
- By hand: fill a room with 40 messages and confirm that going from 640px to 1280px shows
  **more messages**, not larger ones.

## 6. The room lobby (rail list, filter, join)

The rail from §2 is a **room lobby**: a list of rooms sorted by how many people are active
in each, filterable to public or private, with joining a room switching the main container
to the conversation.

### 6.1 Rooms are a fixed, admin-owned set (2026-09-22)

**Only an administrator creates rooms.** Players join; they never create. This replaces the
original ad-hoc model, where a room existed merely because someone typed a slug into a URL
and `POST /chat/token` minted a token for anything matching `[a-zA-Z0-9_-]{1,64}`.

This one decision resolves the two constraints that previously distorted this design:

- **There is now a room registry**, so the list is read from a table rather than inferred
  from channel traffic.
- **Private rooms become listable.** Previously a private room was undiscoverable because
  nothing server-side knew it existed. An admin-curated room _is_ known, so the UI can show
  its name and gate entry on the secret. The Public/Private filter is therefore a genuine
  two-way filter over one server list — not the local-history "Yours" tab the earlier draft
  settled for.

#### Schema (`apps/server/src/db/schema.ts`, new migration)

```
chat_rooms
  id           text primary key      -- the slug, e.g. "global"
  label        text not null         -- display name
  visibility   text not null         -- 'public' | 'private'
  secret       text null             -- room code; required iff visibility='private'
  sort_order   integer not null default 0
  created_at   timestamptz not null default now()
```

Seeded by the migration:

| id       | label   | visibility | secret |
| -------- | ------- | ---------- | ------ |
| `global` | Global  | public     | `null` |
| `pvt`    | Private | private    | `1234` |

**The secret is stored as plaintext, deliberately.** It is a shared room code that every
member already knows, not a user credential — and storing it readably is what makes
"change it later in the DB" a one-line `UPDATE`. The cost is accepted with three rules:
it is **never** returned by any endpoint, **never** logged, and **never** presented to a
user as something to reuse as a password.

#### The channel derivation does not change

`privateChannel.ts` stays exactly as it is. The registry is a **gate in front of** the
existing HMAC derivation, not a replacement for it:

1. Look up the room. Unknown id → `404 UNKNOWN_ROOM` (today: a token is happily minted).
2. Public → derive `chat:<id>`, mint the token.
3. Private → compare the submitted secret to the stored one. Mismatch → `403 BAD_SECRET`.
   Match → derive `chat:p-<hmac>` exactly as today and mint.

Note the behavioural change on a wrong secret: today you silently land on a _different,
empty_ channel and see nothing; now you are told the secret is wrong. That is better UX and
costs nothing, because the registry already reveals that the room exists.

#### What this removes

- **`?p=1` becomes redundant** — the registry knows a room's visibility, so a link no longer
  has to hint at it. Keep parsing it for old links; stop generating it.
- **CHAT-019's "create room" affordance must go** (merged in #84). The room dialog becomes
  join-only, or is replaced entirely by the lobby rail. This is a deliberate removal of
  shipped UI, not an oversight.
- **The "Yours" tab is dropped**, along with the `localStorage` room-history list it needed.
- Secrets still live in `sessionStorage` only, so a private room re-asks for its code in a
  new session. Unchanged, and still correct.

### 6.2 The room list endpoint

`GET /api/chat/rooms` → `{ rooms: [{ id, label, visibility, active }] }`.

- **Rooms come from the table; `active` comes from Ably occupancy** (§7), joined in by id.
  A room with nobody in it still appears, with `active: 0` — that is the point of having a
  registry.
- **`secret` is never in the response.** `visibility` alone tells the client to gate.
- **Sort:** `sort_order` asc → `active` desc → `id` asc. Admin intent wins over popularity;
  ties are broken stably so the list does not shuffle between polls.
- **Cached server-side ~15s**; the client polls every 30s and on window focus.
- If Ably occupancy fails, **the list still renders from the table** with counts omitted
  entirely (not zeroed — an omitted count is honest, a zero is a lie).

### 6.3 Join flow

| From         | Behaviour                                                                              |
| ------------ | -------------------------------------------------------------------------------------- |
| Public row   | Navigate to `roomPath(id)`, conversation opens immediately                             |
| Private row  | Navigate to `roomPath(id)` → **secret gate** (the existing `.lockGate`) → conversation |
| Direct URL   | Same, resolved from the registry rather than from `?p=1`                               |
| Unknown slug | "That room doesn't exist" + a link to Global. Not a dead end, not a silent empty room  |

There is no "join by name" field and no create control — the list is the complete set of
rooms, which is the whole point of admin ownership.

### 6.3.1 Admin separation

Creating rooms needs no API surface in v1: **rooms are managed directly in the database**
(`pnpm --filter @mpg/server db:studio`, or plain SQL). Zero new attack surface, zero auth
code, and it matches how the secret is meant to be rotated.

If an admin API is wanted later, the minimum that fits this codebase is an `ADMIN_TOKEN`
env var checked as a bearer header on `POST/PATCH/DELETE /api/chat/rooms` — the app has
session tokens but no user accounts, so there is no role to hang this off yet.

### 6.4 The view switch

**≥ 64rem** — the lobby rail persists; joining swaps only the conversation column. Nothing
about the rail changes, so there is no "switch" to perceive.

**< 64rem** — the lobby is a full screen and joining _replaces_ it with the conversation:

```
   LOBBY (narrow)                 JOINED (narrow)
┌──────────────────────┐      ┌──────────────────────┐
│ 🏠 Home     Chat     │      │ ← Rooms   🔒 pvt     │
├──────────────────────┤      ├──────────────────────┤
│ [ All | Public | 🔒 ]│      │                      │
│ # Global       12 ●  │      │   messages fill the  │
│ 🔒 Private      4 ●  │      │   whole container    │
│                      │      │                      │
│                      │      ├──────────────────────┤
│                      │      │ [ type a message… ]  │
└──────────────────────┘      └──────────────────────┘
```

- The return control is **"← Rooms" with a visible text label**, never a bare chevron (§9).
- The conversation view is unchanged from §1–§3: composer pinned at the bottom, message list
  taking every remaining pixel as the one scroll region.
- **A direct URL still opens a room**, so the lobby is a convenience rather than the only
  route (§9). With two seeded rooms the filter is near-pointless at first; it is built
  because the set is admin-grown, not because it earns its keep on day one.

### 6.5 States and degradation

The room list is an enhancement layered on an enhancement — it must degrade harder than
anything else on the screen:

- **Loading** — skeleton rows in the rail; the conversation is unaffected and never waits.
- **Counts unavailable** (Ably occupancy failed) — rooms still list, counts omitted. An
  omitted count is honest; a zeroed one is a lie.
- **List unavailable** (the registry query failed) — **the list is simply not rendered.** No
  error row, no retry button, no spinner. A direct URL still reaches a room, and the game is
  untouched.
- **A room that turns out to be empty on arrival is not an error** — counts are a ~15s-stale
  hint, and the UI must never promise otherwise (no "12 people are waiting!").
- **A wrong secret is a recoverable, in-place error** on the gate — "That code doesn't
  match", field retained, focus kept. Never a bounce back to the lobby.

### 6.6 Accessibility

- The list is a `<ul>` of links (real navigation), not click-handled `<div>`s.
- The public/private filter is a **tab pattern** (`role="tablist"`, arrow-key navigation),
  with the active tab announced.
- The active-member count needs a text label, not a bare number + dot:
  `aria-label="tactics, 4 people active"`.
- The narrow-screen view switch moves focus to the conversation heading on join, and back to
  the room row on return — otherwise a keyboard user is dropped at the top of the document.

## 7. Where `active` comes from — resolved (2026-09-22)

**Ably channel enumeration + occupancy works on our account.** Verified directly against
`rest.ably.io` with the `spikes/ably-notify` key:

| Probe                                      | Result                                               |
| ------------------------------------------ | ---------------------------------------------------- |
| `GET /stats`                               | 200 — key authenticates                              |
| `GET /channels?by=id`                      | 200 — enumeration permitted, not plan-blocked        |
| `GET /channels?by=id,occupancy`            | 200, with a full `status.occupancy.metrics` block    |
| 3 real subscribers attached to one channel | `connections=3, subscribers=3` — counts are accurate |

So `active` = `status.occupancy.metrics.subscribers` — people with the room **open right
now**, which is the number the sort actually wants. No presence set is needed, so client
tokens stay `["subscribe"]`-only (`chatRoutes.ts:159`) and nothing about the token
capability changes.

Three consequences that shape the endpoint:

- **Enumeration lists private channels too.** The probe returned `chat:p-deadbeef`
  alongside the public channel. The hash leaks no room name, but the server must still
  filter `^chat:p-` server-side so the count of private rooms never reaches a client —
  this is now a tested requirement, not a precaution (§6.1).
- **Only _active_ channels are listed.** A room nobody is sitting in vanishes from
  enumeration entirely. With the registry (§6.1) this is now harmless — the room set comes
  from the table and enumeration only decorates it with counts, so an empty room still
  lists with `active: 0`. `lastMessageTs` is dropped from the response entirely;
  `sort_order` → `active` → `id` is a complete sort.
- **Occupancy for a private room must be looked up by derived channel name**, not by
  scanning the listing: the server knows the room's secret, so it can compute
  `chat:p-<hmac>` and match it. This keeps the `^chat:p-` filter above intact — private
  hashes are dropped from the raw listing, then re-attached deliberately to the rooms the
  registry already vouches for.
- **The server key needs the `channel-metadata` capability.** The spike key has it. Confirm
  the production key does too — capabilities are per-key, and this is the one way the
  feature can work in dev and 401 in prod.

Remaining caveat: the production `ABLY_API_KEY` is Vercel-redacted on pull
(`.vercel/.env.production.local` contains `[encrypted]`), so this was verified on the spike
app, not the production app. Plan limits are account-level, so it transfers **provided both
apps live in the same Ably account** — worth one glance at the dashboard before building.

The recent-activity proxy is no longer needed. It stays documented only as the fallback if
the production key turns out to lack `channel-metadata`.

## 8. Open questions

**Resolved 2026-09-22:**

- **Admin surface: none in v1.** Rooms are managed directly in the database; no create/edit
  API, no `ADMIN_TOKEN`. The repo layer is shaped so endpoints can be added later without
  reworking it (§6.3.1).
- **`DEFAULT_CHAT_ROOM_ID` becomes `global`**, `/chat` points at it, and `lobby` redirects to
  `global` so already-shared links keep working.

Still open:

- Message grouping (1.3) changes the accessible name of a bubble — needs a pass on what a
  screen reader announces for a headerless follow-up message.
- **Rate-limiting the secret gate.** With a listable private room, the gate is now a
  guessable target in a way it never was before — `1234` in particular. `chat_token` is
  already rate-limited; confirm the limit is tight enough to matter for a 4-digit code, and
  consider a longer default secret.
