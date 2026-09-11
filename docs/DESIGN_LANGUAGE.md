# Design Language — "Table & Cabinet"

Visual direction for `apps/web`. Complements [UX_PRINCIPLES.md](UX_PRINCIPLES.md):
that document sets the quality bar every screen must clear, this one sets what the
screens should look like while clearing it.

- **Status:** adopted. Foundations (UI-1…UI-3) shipped in `32bc7f2`; UI-4 shipped
  with MPG-090; UI-5…UI-12 are on the backlog as MPG-112…MPG-119.
- **Baseline it was written against:** `main @ 10ec79b` (MPG-056).
- **Source:** originally drafted as a rendered proposal —
  <https://claude.ai/code/artifact/f4c79e7a-8878-425d-9615-f32b653c5002> — which
  contains live mock-ups of every screen. This file is the checked-in record; the
  artifact is the visual reference.
- **Unchanged by this direction:** CSS Modules + CSS-variable tokens
  (`styles/tokens.css`, `data-theme` beating `prefers-color-scheme`), the Okabe–Ito
  seat colours, and the verified AA contrast table in the token file header.

---

## 1. Why — what the pre-`32bc7f2` UI was doing

The foundations were sound (real token file, verified AA ratios, colourblind-safe
seat colours, a reduced-motion kill switch). The problems were **compositional**.

| Severity  | Finding                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collision | **The brand accent was the same colour as player one.** `--color-accent: #2f5fff` and `--color-player-1: #0072b2` are both blue, so mid-game a focus ring, a primary button and a player-one disc all read as the same signal. That defeats the point of the Okabe–Ito choice: a seat colour must mean exactly one thing. |
| Wasted    | **Glass applied where nothing sits behind it.** `HomeScreen.module.css` put `backdrop-filter: blur(16px)` on cards floating over a flat `--color-bg`. Blurring a solid colour returns that solid colour — cost paid, effect absent, cards land as low-contrast grey boxes.                                                |
| Unused    | **Every game has a written description nobody sees.** `catalog.ts` carries a one-line hook for all eight games; Home rendered the title and a tag and dropped the description. A player choosing between Nim and Gomoku got two words.                                                                                    |
| Off-brief | **Developer chrome in the consumer footer.** Home ended with `Engine version: 0.x` and a "View design-system kit" button. A stranger arriving from a shared link meets a build stamp and an internal component gallery.                                                                                                   |
| Flat      | **One typeface, one weight range, no numeric treatment.** Everything `system-ui` at 400/500/700. Reaction times, scores and ranks all rendered in proportional figures that jitter as they tick. No display voice, no data voice.                                                                                         |

## 2. The direction — two temperatures, one system

[ADR 0002](adr/0002-realtime-games.md) already splits the catalogue into
**turn-based** (seats, setup, turns) and **real-time** (solo, no seats, straight to
play). That structural fact was carried only by a small uppercase tag. It should
carry the visual treatment instead — same tokens, two grounds.

**The table** — turn-based (Tic-Tac-Toe, Connect Four, Nim, Gomoku, Move-Mode TTT).
Matte, ruled, unlit. A surface you place pieces on. Boards sit on `--color-table`;
pieces catch a highlight; nothing glows. Calm enough to think in.

**The cabinet** — real-time (Floppy Birds, Drunk Walk, Reflex Test). Emissive,
scanlined, high-contrast. A screen, not a page. This is where glass and glow earn
their keep — they have a real backdrop to act on.

### The one deliberate rule-break

**Arcade play surfaces stay dark even in light theme.** This is a documented
exception to "design both themes", taken because a light-mode Floppy Birds sky
washes the bird out, and every arcade screen a player has ever seen was a lit panel
in a dark bezel.

The exception is **scoped to the play surface only**. The surrounding chrome, the
HUD text and the result card remain theme-aware and AA-verified. Do not widen it.

## 3. Tokens

Additive where possible. The neutral ramp shifts from pure grey to grey with a
slight violet bias so surfaces sit _under_ the accent rather than against it. The
seat, semantic and focus contracts are untouched.

| Token                     | Value (light / dark)     | Note                                                       |
| ------------------------- | ------------------------ | ---------------------------------------------------------- |
| `--color-accent`          | `#a81e67` / `#f26fb2`    | Signal plum. Off blue, permanently.                        |
| `--color-player-1/2`      | unchanged                | Okabe–Ito. **Non-negotiable.**                             |
| `--color-table`           | `#e9e5ee` / `#1e1a2a`    | Board ground (+ `--color-table-line`)                      |
| `--color-cabinet`         | `#120e1c` / `#0d0a14`    | Arcade ground (+ `-raised`, `-line`, `--color-on-cabinet`) |
| `--field-page`            | radial-gradient pair     | The ambient field glass actually blurs                     |
| `--border-width-hairline` | `1px`, `0.5px` ≥ `2dppx` | One _device_ pixel, not one CSS pixel                      |

**Glass rule:** `backdrop-filter` is only permitted on a surface that genuinely
floats over something with structure — the arcade HUD, the Drunk Walk customize
menu, a modal over a live board. Never over flat `--color-bg`.

### Type voices

| Voice   | Token                   | Used for                                            |
| ------- | ----------------------- | --------------------------------------------------- |
| Display | `--font-family-display` | Game titles, verdicts, hero lines (700/800)         |
| Body    | `--font-family-base`    | Prose, descriptions, controls                       |
| Data    | `--font-family-mono`    | Scores, times, ranks, countdowns, micro-caps labels |

`--font-family-display` is `ui-rounded` — a real system face on Apple platforms,
degrading through Segoe UI Variable and Nunito to `system-ui`. **No webfont**, so
no download and no silent fallback to something wrong.

`font-variant-numeric: tabular-nums` is **mandatory** for every score, time, rank
and countdown, so digits stop shifting as they tick.

## 4. Catalogue tags and the line between the families

`kind` is architectural — it decides which router branch a game takes. `tags` are
player-facing — they decide how someone scans, filters and understands the shelf.
The two are orthogonal and must stay so.

Seat-count tags (`solo` / `2-player` / `multiplayer`) are **never authored**;
`gameTags()` derives them from `playerCount`, so a catalogue entry can never claim
"2-player" while `playerCount` disagrees. Entries author only the non-derivable
facets (`AuthoredGameTag`: `vs-bot`, `online`, `watch`, `quick`, `endless`).
Authoring only what isn't derivable is the difference between a field that stays
true and one that drifts the first time a three-seat game lands.

**Chip hierarchy:** the seat tag is the only chip with a filled background — it
answers "can I play this with someone?" at a glance. Every other tag stays a
hairline outline so the row doesn't turn into confetti.

**The divider** between shelves should be the quietest mark on the page; it states
a fact, it doesn't compete with the cards. Hence `--border-width-hairline`, and a
label in the same mono micro-caps as the shelf headers.

**Which axis the shelves split on (decided with UI-4 / MPG-090).** This section
originally assumed shelves split by _family_ — table above, cabinet below.
MPG-090 needs them to split by _discovery_ (Featured / Trending / New), and both
can't be the top-level grouping. Discovery won: it is what a player arriving cold
is actually asking, and a Featured shelf that couldn't mix a board game with an
arcade game would be a worse shortlist. The family signal moved down onto the card
itself — turn-based cards are matte table stock, real-time cards are lit cabinet
panels — so a mixed shelf still reads as two temperatures at a glance, and a
"Solo arcade" chip keeps that signal in text rather than colour alone.

## 5. Rollout slices

Ordered so each ships on its own; nothing is a big-bang rewrite. UI-9…UI-12 are
in-game work and can run in parallel with the shell slices — they touch no shared
screens.

| Slice | Backlog | What changes                                                                                                                             | Touches                                                                              | Size | Status                  |
| ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---- | ----------------------- |
| UI-1  | —       | Accent off blue; violet-biased neutrals; `--color-table`, `--color-cabinet`, `--field-page`; contrast table re-verified                  | `styles/tokens.css`                                                                  | S    | ✅ `32bc7f2`            |
| UI-2  | —       | `--font-family-display`; every score/time/rank/countdown to mono + `tabular-nums`                                                        | `tokens.css` · Reflex/Floppy scenes · Leaderboard · RankPreview                      | S    | ✅ `32bc7f2`            |
| UI-3  | —       | `GameTag` + `tags` on both entry types; seat tag derived via `gameTags()`; `--border-width-hairline`. Data + token only                  | `screens/catalog.ts` · `styles/tokens.css`                                           | S    | ✅ `32bc7f2`            |
| UI-4  | MPG-111 | Home rebuilt: shelves split by the hairline, tag chips, descriptions rendered, matte cards, personal-best chip, dev footer behind `?dev` | `HomeScreen.tsx` + `.module.css` · `App.tsx` · `catalog.ts` · `game/personalBest.ts` | M    | ✅ shipped with MPG-090 |
| UI-5  | MPG-112 | Tag filter row on Home reading the same `gameTags()` output                                                                              | `HomeScreen.tsx` + `.module.css`                                                     | S    | Backlog                 |
| UI-6  | MPG-113 | Extract a shared `SeatRail`; board surfaces move onto the table ground                                                                   | `components/ui/SeatRail` · GamePlay/OnlineGamePlay/WatchGamePlay                     | M    | Backlog                 |
| UI-7  | MPG-114 | Cabinet treatment + glass HUD; ghost bar vs personal best; glass removed where it has no backdrop                                        | `RealtimePlayScreen` · Floppy/DrunkWalk/Reflex scenes                                | M    | Backlog                 |
| UI-8  | MPG-115 | Result card unified so post-game and shared-link views render one component; rank delta; leaderboard pins your row                       | `SharedResultScreen` · `LeaderboardScreen` · `RankPreview`                           | L    | Backlog                 |
| UI-9  | MPG-116 | Tier-2 material tokens: promote Connect Four's fifteen `rgba()` literals to `--game-*`. Pure refactor, pixel-identical                   | `tokens.css` · `ConnectFourBoard.module.css`                                         | S    | Backlog                 |
| UI-10 | MPG-117 | Shared `BoardGrid` primitive; all five boards onto one cell grammar. Kills radius/gap drift                                              | `components/board/BoardGrid` · all five `*Board.module.css`                          | M    | Backlog                 |
| UI-11 | MPG-118 | Tier-3 scene ramp + memoised `readSceneTokens()`; semantic tokens reserved for state                                                     | `tokens.css` · `lib/sceneTokens.ts` · `FloppyBirdsScene`                             | M    | Backlog                 |
| UI-12 | MPG-119 | Drunk Walk detox: ~75 baked-in literals → scene ramp; tree sprites re-authored to take `currentColor`                                    | `DrunkWalkScene` · character · glyph · cosmetics                                     | L    | Backlog                 |

**Gate for every slice:** the UX Definition of Done in
[UX_PRINCIPLES.md](UX_PRINCIPLES.md) §6 — all required states, AA contrast
re-verified against the new neutrals, reduced-motion honoured, 44px targets intact
— plus `pnpm typecheck` and `pnpm lint` per package before the PR.
