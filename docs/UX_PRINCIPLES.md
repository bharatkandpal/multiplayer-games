# UX Principles & Quality Bar

**Status:** Draft v0.1 · **Last updated:** 2026-08-24
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

## 7. Enablers (so the bar is cheap to hit)

- **Design system / UI kit early** (tokens: color, type, spacing, motion; core components:
  Button, Board, Cell, Toast, Modal, StatusBadge, Skeleton). Built in Phase 1, before
  screens, so every feature inherits the bar instead of re-earning it. (Backlog: MPG-029.)
- **State-driven components:** components take an explicit status prop so loading/empty/
  error/success are impossible to forget.
- **Optimistic-UI helper** in the net layer: apply locally → reconcile on broadcast → revert
  on rejection, in one reusable place (TDD §6, §7).
