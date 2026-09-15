# UX Principles & Quality Bar

**Status:** Draft v0.1 · **Last updated:** 2026-09-15
**Related:** [PRD.md](PRD.md), [TDD.md](TDD.md)

> **This is a P0 product pillar, not polish.** The platform is **UX-centric first**:
> everything that goes in and out — every input, every state change, every message,
> every error — must feel considered, responsive, and calm. A feature that works but
> feels janky is **not done**. The UX bar below is part of the Definition of Done for
> _every_ task, not a phase at the end.

---

## 1. Principles

1. **Instant-feeling by default.** Every user action gets visible feedback in < 100 ms,
   even if the real result is still in flight. Use optimistic UI (reconciled to the
   server's authoritative broadcast) so a move _lands_ the moment you make it.
2. **Never a dead moment.** Every asynchronous state has an explicit, designed
   representation: loading, empty, success, error, offline. No blank screens, no spinners
   with no context, no silent failures.
3. **Always answer "whose turn / what's happening?"** Turn ownership, bot "thinking,"
   opponent presence, and connection status are always legible at a glance.
4. **Errors are calm and recoverable.** No raw error codes or dead-ends. Every error
   states plainly what happened and offers the next step (retry, go back, convert seat to bot).
5. **Motion with meaning.** Animate to explain change (a disc dropping, a win line
   drawing), not to decorate. Respect `prefers-reduced-motion`.
6. **One clear primary action per screen.** Reduce choices; make the obvious next step obvious.
7. **Mobile-first and thumb-friendly.** Designed from 320px up; touch targets ≥ 44px;
   the board is the hero on every screen size.
8. **Accessible is table stakes.** Full keyboard play, visible focus, ARIA on the board,
   WCAG AA contrast, screen-reader announcements for moves/results.
9. **Copy is part of the UI.** Human, concise, encouraging. No jargon. Consistent tone.
10. **Consistency via a system.** Shared design tokens + components so every screen feels
    like one product. No one-off styling.
11. **The screen is the frame.** A player is never made to scroll to reach the game or its
    controls. Everything needed to play and to navigate fits inside the viewport (§9).
12. **Nothing needs teaching.** If a pilot player has to be told an affordance exists, the
    affordance has failed — not the player. Controls are visible, labelled, and where a
    first-timer would look (§9).

## 2. Required states for every interactive surface

Every screen/component must design and implement all applicable states — reviewers check
for these explicitly:

| State                        | Requirement                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| **Loading**                  | Skeletons or inline progress with context (never a bare spinner).                              |
| **Empty**                    | Helpful empty state with a clear call to action.                                               |
| **Optimistic**               | Local action reflects instantly; reconciles to server broadcast.                               |
| **Success**                  | Clear, satisfying confirmation (subtle motion / state change).                                 |
| **Error**                    | Plain-language message + a recovery action. Never a dead-end or raw code.                      |
| **Offline / reconnecting**   | Visible connection status; auto-reconnect with clear messaging.                                |
| **Disabled / not-your-turn** | Illegal actions are visibly disabled _before_ they're attempted, with a reason on interaction. |

## 3. Interaction & feedback standards

- **Action feedback:** hover, active, focus, and pressed states on every control.
- **Latency masking:** optimistic move rendering; the server broadcast reconciles silently
  (and only visibly corrects on the rare rejection, with a gentle explanation).
- **Bot pacing:** a bot's turn shows a "thinking…" indicator; bot-vs-bot watch is paced
  (~600ms) so it's followable, with the option to speed up / step.
- **Move rejection:** if the server rejects a move (out of turn / illegal), the optimistic
  move reverts smoothly with a brief, non-blaming explanation — never a hard error.
- **Win / draw:** animate the winning line/cells; celebratory but quick; rematch is one tap.
- **Sharing (link):** copy-to-clipboard with confirmation; clear "waiting for opponent" state
  that reassures the host something is happening.
- **Transitions:** route/screen changes are smooth; no layout shift (reserve space for async content).

## 4. Accessibility checklist (AA)

- Keyboard: play an entire game with keyboard alone; logical tab order; visible focus.
- Screen readers: announce turn changes, moves, and results via ARIA live regions.
- Contrast: text and game pieces meet WCAG AA; never rely on color alone (use shape/pattern
  for the two sides so it's colorblind-safe).
- Motion: honor `prefers-reduced-motion` (swap animations for instant state changes).
- Targets: interactive elements ≥ 44×44px.

## 5. Performance-as-UX budgets

- First interaction feedback: < 100 ms.
- Move propagation (multiplayer): p95 < 150 ms round-trip (PRD NFR).
- Initial load (POC): interactive board on a mid-range phone in < 2.5 s on a typical connection.
- No layout shift after load (CLS ~ 0); 60fps animations.

## 6. Definition of Done — UX gate (applies to every task)

A task is not done unless, for what it touches:

- [ ] All applicable states from §2 are implemented (not just the happy path).
- [ ] First-feedback < 100 ms; optimistic where a server round-trip is involved.
- [ ] Errors are plain-language with a recovery path.
- [ ] Keyboard + screen-reader usable; AA contrast; not color-only.
- [ ] Responsive 320px → desktop; touch targets ≥ 44px; no layout shift.
- [ ] Motion is meaningful and respects reduced-motion.
- [ ] Uses shared design tokens/components (no one-off styles).
- [ ] Copy reviewed for tone and clarity.
- [ ] **Local play is unaffected with the backend down** (§7) — the feature degrades to
      absence, never to an error or a block.
- [ ] **Fits the viewport** (§9) — at 320×568 and 390×844, the board and every control
      needed to play or navigate are reachable without scrolling.
- [ ] **No control needs explaining** (§9) — every navigation affordance the screen offers
      is visible and labelled; nothing depends on a player discovering it.

## 7. Offline-first: no feature may break local play

**Hard rule.** Every game in the catalogue must be fully playable, start to finish, with
every network service down. Sharing, leaderboards, chat, voice, presence and analytics are
enhancements layered on a game that already works locally — none of them may become a
dependency of playing one.

What this requires of any feature that touches the network:

- **Never block or delay gameplay.** No screen, move or result waits on a request. The
  local engine decides the game; the network is told about it afterwards, fire-and-forget.
- **Degrade to absence, not to an error.** Service down means the affordance is not
  offered — no share button, no rank, chat controls disabled — never an error banner over
  a finished game about something the player never asked for.
- **Never strand the player.** No dead ends, no retry loop in front of the board, no
  spinner that outlives its request.

**Worked example — durable share links (MPG-131).** A finished local game is reported to
`POST /api/results` and a link minted from the id that comes back. Both calls are
fire-and-forget and both swallow their failures: the result screen renders the instant the
game ends, the share button appears a beat later _if_ a link exists, and with the backend
unreachable the player simply sees the ordinary result screen with Rematch. Nothing about
the game changes.

**How to verify.** Stop the backend, then play a game of each kind to completion. Every
single-player and hot-seat game must be unaffected; only network-backed affordances may
disappear. This is part of the §6 gate, not a separate pass.

## 8. Enablers (so the bar is cheap to hit)

- **Design system / UI kit early** (tokens: color, type, spacing, motion; core components:
  Button, Board, Cell, Toast, Modal, StatusBadge, Skeleton). Built in Phase 1, before
  screens, so every feature inherits the bar instead of re-earning it. (Backlog: MPG-029.)
- **State-driven components:** components take an explicit status prop so loading/empty/
  error/success are impossible to forget.
- **Optimistic-UI helper** in the net layer: apply locally → reconcile on broadcast → revert
  on rejection, in one reusable place (TDD §6, §7).

## 9. The screen is the frame — no forced scrolling, no hidden navigation

**Added 2026-09-15, from pilot-user feedback.** Two failures were observed together and
they share one cause: the play screen is laid out as a _document_ that happens to contain a
game, rather than as a _frame_ the game has to fit inside.

1. **Players were scrolled off the game.** Controls and the board did not co-exist in the
   viewport, so reaching one meant losing sight of the other.
2. **Pilot users had to be taught the navigation.** Prev/next game, switching to a bot
   opponent, and going Home all existed, but none of them announced itself — the Home
   control in particular is two small glyphs with no visible label.

### The rules

- **The viewport is a hard budget, not a suggestion.** On every screen, the board (or the
  screen's primary content) plus every control needed to act on it fit within the visible
  area, at 320×568 and 390×844, with no page scroll. If it doesn't fit, something is cut or
  demoted — the layout is not extended downward.
- **Vertical space is spent on the board first.** Chrome (headers, status rows, seat rails,
  action bars) competes for the same budget and must stay compact. The board is the hero
  (§1.7) and gets the remainder.
- **Scrolling, where it is genuinely unavoidable** (long leaderboards, catalogue shelves),
  is scoped to a single region that scrolls _inside_ the frame. The page itself never
  scrolls, and controls never scroll out of reach.
- **Navigation lives in a persistent bottom action bar during play.** Thumb-reachable on a
  phone, always visible, never revealed by scrolling:

  ```
  ┌──────────────────────────────────────────┐
  │ 🏠   Connect Four                        │
  │                board                     │
  ├──────────────────────────────────────────┤
  │  ‹ Prev    🤖 vs Bot    Next ›           │
  └──────────────────────────────────────────┘
  ```

  The top bar keeps only Home and the title; prev/next game and the opponent switch move
  to the bottom bar.

- **Every navigation control carries a visible text label**, not a bare glyph. Icon-only
  with an `aria-label` satisfies a screen reader and fails a sighted first-timer.
- **The Home control is larger than it is today** and reads as an exit: a bigger glyph plus
  the word "Home", meeting the 44px target with room to spare rather than exactly.
- **No affordance is discovered by gesture.** No swipe-only game switching, no long-press,
  no off-screen drawer as the only path to a feature.

### How it is built (MPG-137)

The law is a layout contract, not a per-screen habit, so it is implemented once in the
shell and inherited:

- **`App.module.css` `.main` is exactly one viewport tall** (`100dvh`, with a `100vh`
  fallback) and `overflow: hidden`; `html, body` are locked too, so a document-level
  scrollbar can only ever be a bug leaking out.
- **`.screen` is the single scrolling region** on a page screen (Home, Setup, Leaderboard,
  a shared result). The chrome outside it never moves.
- **In-game there is no scrolling region at all.** The play column is a flex column whose
  board sits in a `container-type: size` area taking the remainder; each board clamps its
  width against that height (`min(<max>, calc(100cqh * <aspect>))`), so a short frame gets
  a smaller board rather than an action bar pushed off screen.
- **On game-over the result actions are the one thing that gives**: the board holds a floor
  and the actions block shrinks and scrolls, so Rematch is never what disappears.

### How to verify

`e2e/layout-frame.spec.ts` asserts all of this in a real browser at both sizes — jsdom has
no layout, so unit tests cannot see this class of regression at all. By hand: load the
screen at 320×568 and 390×844 and confirm nothing is clipped and every control is
reachable. Then hand it to someone who has never used the app and say nothing: if they ask
"how do I get back?" or "how do I play a bot?", the screen has not met this bar.

Backlog: **MPG-136** (in-game bottom action bar + larger Home) and **MPG-137** (no-scroll
viewport layout across the remaining screens) — both landed.
