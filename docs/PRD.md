# Product Requirements Document (PRD)

**Product:** Multiplayer Games Platform
**Status:** Draft v0.2
**Last updated:** 2026-08-24
**Owner:** Bharat

---

## 1. Vision & Horizons

A web platform for small, turn-based games — playable against bots, against friends,
or watched between bots. Two horizons drive the product:

- **North-star (later versions — the real goal):** a **company / HR event platform**.
  During a Friday event, 100–200 employees gather to **watch and play** together —
  tournaments, spectators, a big shared screen, and leaderboards. Presence-heavy, but
  modest absolute concurrency (hundreds of people, not tens of thousands).
- **POC (build now):** a casual experience for the general public and kids to play with
  friends. **1v1 only** for the POC. Launch games: **Connect Four** (4-in-a-row) and
  **Tic-Tac-Toe** (0-X).

Everything in the POC is built so the north-star is additive, not a rewrite.

**Product pillar — UX-centric first.** This is a defining, P0 quality bar, not polish:
everything that goes in and out (every input, state change, message, and error) must feel
responsive, calm, and considered. A feature that works but feels janky is **not done**. The
UX bar is part of the Definition of Done for _every_ task — see [UX_PRINCIPLES.md](UX_PRINCIPLES.md).

## 2. The Seat & Bot Model (core concept)

The platform has **no separate "AI mode" and "multiplayer mode."** Instead, a game room
has **N seats**, and each seat is either:

- a **human**, or
- a **bot**, with its **own difficulty** (Easy / Medium / Hard).

The "mode" is simply how the seats are filled:

| Configuration      | Seats                      | Experience                                                        |
| ------------------ | -------------------------- | ----------------------------------------------------------------- |
| Play vs computer   | 1 human + 1 bot            | Solo practice vs AI                                               |
| Play with a friend | 2 humans                   | 1v1 over a shared link                                            |
| Fill empty seats   | humans + bots (any levels) | Not enough people? Assign bots to the open seats                  |
| Watch mode         | all bots                   | Assign e.g. a Medium bot vs a Hard bot and **spectate them play** |

Requirements that follow from this model:

- The user can **assign any seat to a bot** and pick that bot's level.
- **Mixed bot levels in one room** are supported (e.g. one Medium + one Hard).
- **Bot-vs-bot** rooms let a human watch instead of play.
- The engine and room model are **N-seat capable** — the POC ships 1v1, but nothing
  hardcodes "2 players." Teams (2v2) and 3+ players are additive later.

## 3. Goals & Non-Goals

### POC Goals

- Polished, low-friction 1v1 Connect Four and Tic-Tac-Toe in the browser.
- Bots via minimax at three levels (Easy / Medium / Hard), assignable **per seat**.
- Fill an empty seat with a bot at a chosen level; support **bot-vs-bot watch**.
- 1v1 real-time play via a shareable link, no account required.
- A reusable seat + engine framework so new games and more seats are additive.

### North-star Goals (later versions — designed for, not built in POC)

- Company/HR **event mode**: organizer creates an event, many rooms, a shared big-screen view.
- **Spectators** watching live games at scale (hundreds of concurrent viewers).
- **Tournaments / brackets** and **leaderboards**.
- **Teams (2v2)** and **3+ player** game variants.
- **Games as installable npm packages (v2):** each game packaged so anyone can add a game
  to a platform instance via `npm install` against a stable public plugin API. (Note only for
  now — shapes how we keep the engine/`GameModule` boundary clean.)

### Non-Goals (not now, maybe never)

- User accounts / logins / persistent profiles in the POC (introduced with event mode).
- Matchmaking with strangers (POC is link-share only).
- Ranked ELO ratings, real-money, ads, or monetization.
- Native mobile apps (responsive web only).
- Voice/video chat.

> Changed from v0.1: "max 2 players" and "spectators" are **no longer non-goals** — they
> are core to the north-star. The POC scopes them out only by _timing_, not by design.

## 4. Target Users & Personas

- **Casual solo player / kid** — wants a quick game vs a bot, tunable difficulty; or fills
  empty seats with bots to play with a couple of friends.
- **Pair of friends** — one shares a link; both play 1v1 from wherever they are.
- **Curious watcher** — assigns two bots at different levels and watches them play to see
  how the AI behaves. (Also the seed of spectator mode.)
- **HR / event organizer (north-star)** — runs a company event, sets up rooms/brackets,
  drives a big-screen view for a crowd. _Not a POC persona; captured so we don't design against it._
- **Event spectator (north-star)** — an employee watching games live on a shared screen.

## 5. User Stories

### Setting up a game (seat configuration)

- As a player, I can start a game and see the seats for that game.
- As a player, I can set each seat to **human** or **bot**, and choose the bot's level.
- As a player, I can fill an empty seat with a bot when I don't have enough people.
- As a player, I can set **all** seats to bots and **watch** them play.
- As a player, I can mix bot levels (e.g. Medium vs Hard) in the same game.

### 1v1 vs a bot

- As a player, I can start a 1v1 vs a bot in one click and pick Easy/Medium/Hard.
- As a player, I see whose turn it is and when a bot is "thinking."
- As a player, I see the result (win / lose / draw) and can start a rematch.

### 1v1 vs a friend (link share)

- As a host, I create a room, get a shareable link, and share it.
- As an invitee, I open the link and join as the second player.
- As a player, I see the opponent's moves in real time and whose turn it is.
- As a player, if my opponent disconnects, I'm told and it's handled gracefully;
  optionally I can **convert the empty seat to a bot** and keep playing.
- As a player, I can request a rematch after a game ends without re-sharing a link.

### Cross-cutting

- As a player, illegal / out-of-turn moves are prevented (server-authoritative).
- As a player, the board is readable and playable on mobile and desktop.

## 6. Functional Requirements

| ID    | Requirement                                                                | Priority |
| ----- | -------------------------------------------------------------------------- | -------- |
| FR-1  | Home lists games; game setup shows configurable **seats**.                 | P0       |
| FR-2  | Connect Four with correct win detection (H / V / both diagonals).          | P0       |
| FR-3  | Tic-Tac-Toe with correct win/draw detection.                               | P0       |
| FR-4  | Bot opponent using minimax + alpha-beta.                                   | P0       |
| FR-5  | Three bot levels: Easy / Medium / Hard (see GAME_LOGIC.md).                | P0       |
| FR-6  | **Per-seat player type** — assign any seat to human or bot.                | P0       |
| FR-7  | **Per-seat bot difficulty**, including mixed levels in one room.           | P0       |
| FR-8  | **Bot-vs-bot watch** — all seats bots; human spectates.                    | P1       |
| FR-9  | Create room → shareable invite link.                                       | P0       |
| FR-10 | Join room via link; assign to an open human seat; reject if full/expired.  | P0       |
| FR-11 | Real-time move sync (server-authoritative).                                | P0       |
| FR-12 | Turn enforcement + server-side legal-move validation, all seat types.      | P0       |
| FR-13 | End-of-game state (win/lose/draw) + rematch.                               | P0       |
| FR-14 | Disconnect handling with reconnect grace; option to convert seat to bot.   | P1       |
| FR-15 | Optional display name (no auth) shown to others.                           | P1       |
| FR-16 | Engine + room are **N-seat capable** (no hardcoded 2).                     | P0       |
| FR-17 | _(North-star)_ Spectator seats: read-only live view, scalable to hundreds. | P2       |
| FR-18 | _(North-star)_ Event/tournament orchestration + leaderboards.              | P3       |

## 7. Non-Functional Requirements

- **Latency:** move propagation p95 < 150 ms server round-trip on a normal connection.
- **Bot responsiveness:** move computed < 500 ms at Hard for both launch games.
- **Concurrency (POC):** ≥ 500 concurrent rooms on a single small backend node.
- **Concurrency (north-star target):** an event of **100–200 concurrent participants +
  spectators** on modest infrastructure. (Within Node + Socket.IO + Redis-adapter range —
  see ADR 0001.)
- **Security:** server authoritative for all game state; clients never trusted. Room IDs unguessable.
- **UX (P0 pillar):** first-interaction feedback < 100 ms; optimistic UI reconciled to
  server; every async state has a designed loading/empty/error/offline representation;
  errors are plain-language with a recovery path. Full bar in [UX_PRINCIPLES.md](UX_PRINCIPLES.md).
- **Accessibility:** full keyboard play, WCAG AA contrast, ARIA + live-region move
  announcements, not color-only, honors reduced-motion.
- **Responsive:** mobile-first, usable from 320px width up; touch targets ≥ 44px; no layout shift.
- **Privacy:** no PII stored in the POC; rooms are ephemeral and expire.

## 8. UX Flows (high level)

**Play vs bot:** Home → pick game → seats: [me] vs [bot: level] → play → result → rematch.

**Play with a friend:** Home → pick game → seats: [me] vs [open] → create link → share →
guest joins open seat → play → result → rematch. _(Empty seat can be switched to a bot.)_

**Watch bots:** Home → pick game → seats: [bot: Medium] vs [bot: Hard] → watch → result.

## 9. Success Metrics

- Time-to-first-move (vs bot) < 5 s from home.
- Guest join success rate > 95% of opened valid links.
- Median bot move time within targets across levels.
- < 1% of games end in an unrecoverable error state.

## 10. Open Questions

- Turn clock in link-share games for the POC? (Assumed: no.)
- Easy bot: "random with occasional good moves" or "shallow minimax"? (Proposed in GAME_LOGIC.md.)
- ~~Persist finished-game results in the POC, or fully ephemeral?~~ **Resolved
  ([ADR 0003](adr/0003-durable-persistence.md)):** we **persist** server-authoritative
  finished-game results (and their move/input logs) in Postgres once the first durable
  social feature ships — decoupled from accounts, on a minimal no-PII session token.
- Display-name profanity filtering for the POC? (Assumed: light client-side check.)
- For bot-vs-bot watch, do we want a pacing delay between moves so it's watchable? (Assumed: yes, ~600ms.)

## 11. Assumptions

- POC ships 1v1; the seat/engine framework generalizes to teams, N-players, spectators.
- No login for the POC; identity is per-session/socket.
- Event mode (north-star) is a later version; the POC must not design against it.
