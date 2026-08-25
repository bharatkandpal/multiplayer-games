---
name: ux-review
description: Run the platform's UX Definition-of-Done review against changed client/UI code. Use before merging any UI work, or when asked "UX review this", "does this meet the UX bar", "check the states/accessibility". Verifies required states, feedback/latency budgets, recoverable errors, accessibility (AA), responsiveness, and design-system consistency per docs/UX_PRINCIPLES.md.
---

# UX review

UX is a **P0 pillar** for this platform. This review enforces the codified bar so quality
never slips into a "polish later" bucket. Rubric: `docs/UX_PRINCIPLES.md` (§2–§6).

## How to run
1. Identify the interactive surfaces changed (screens/components/interactions).
2. For each, walk the checklist below. Cite `file:line` and describe the user-visible gap
   ("user sees X, should see Y") and which rubric item it fails.
3. Rank findings by user impact (most impactful first). Approve only when §6 is fully met.

## Checklist (from UX_PRINCIPLES.md)
- [ ] **All required states** implemented: loading, empty, optimistic, success, error,
      offline/reconnecting, disabled/not-your-turn (§2). No happy-path-only.
- [ ] **Feedback < 100ms**; optimistic UI where a server round-trip is involved; smooth
      revert with a gentle explanation on `move:rejected` (not a hard error) (§3).
- [ ] **Errors** are plain-language, non-blaming, with a recovery action — no raw codes/dead-ends.
- [ ] **Accessibility (AA):** full keyboard play, visible focus, ARIA + live-region
      announcements for moves/results, not color-only, honors `prefers-reduced-motion` (§4).
- [ ] **Responsive/mobile-first:** 320px up, touch targets ≥ 44px, no layout shift (§5).
- [ ] **Motion is meaningful**; 60fps; CLS ~ 0 (§5).
- [ ] **Consistency:** shared design-system tokens/components only; no one-off styling.
- [ ] **Copy** is clear, human, consistent in tone.
- [ ] **Bot/turn legibility:** whose turn, bot "thinking…", opponent presence, connection
      status are all glanceable; watch mode is paced and followable.

## Output
A ranked gap list (or explicit approval). This skill reviews only — hand fixes to the
`frontend-dev` agent; escalate design ambiguities to `staff-architect`.
