# Game Logic & AI Design

**Status:** Draft v0.1 · **Related:** [TDD.md](TDD.md)

Defines the rules of each launch game, win detection, and the minimax AI including
how the three difficulty levels behave.

---

## 1. Tic-Tac-Toe (0-X)

- **Board:** 3×3 grid, cells empty / X / O.
- **Players:** X and O; X moves first (host / player 1).
- **Move:** place your mark in any empty cell.
- **Win:** three of your marks in a line — 3 rows, 3 columns, 2 diagonals (8 lines).
- **Draw:** board full with no line.
- **State rep:** `number[9]` or `('X'|'O'|null)[9]`; `legalMoves` = indices of empty cells.
- **Search space:** tiny (≤ 9! ≈ 362,880 leaf orderings) → minimax solves it fully.

## 2. Connect Four (4-in-a-row)

- **Board:** 7 columns × 6 rows.
- **Players:** two colors; player 1 moves first.
- **Move:** drop a disc into a non-full column; it falls to the lowest empty row.
- **Win:** four in a row horizontally, vertically, or on either diagonal.
- **Draw:** all 42 cells filled, no four-in-a-row.
- **State rep (v1):** `number[6][7]` (0 empty, 1/2 player). Optional later:
  **bitboard** (two 64-bit masks) for fast win checks and deep search.
- **Win detection:** check the 4-in-a-row windows through the last placed disc
  (O(1)-ish per move) rather than scanning the whole board.
- **Search space:** large (~4.5×10¹²) → **depth-limited** minimax + heuristic eval.

## 3. Minimax + Alpha-Beta (generic)

One generic implementation drives both games via the `GameModule` interface.

```
function minimax(state, depth, alpha, beta, maximizing, game):
    result = game.getResult(state)
    if result is terminal or depth == 0:
        return terminalOrHeuristicScore(result, state, game, depth)

    moves = orderMoves(game.legalMoves(state))   # center-first for Connect Four
    if maximizing:
        best = -∞
        for m in moves:
            score = minimax(game.applyMove(state, m, AI), depth-1, alpha, beta, false, game)
            best = max(best, score); alpha = max(alpha, best)
            if alpha >= beta: break            # prune
        return best
    else:  # minimizing (opponent)
        best = +∞
        for m in moves:
            score = minimax(game.applyMove(state, m, HUMAN), depth-1, alpha, beta, true, game)
            best = min(best, score); beta = min(beta, best)
            if alpha >= beta: break
        return best
```

**Scoring conventions**
- Terminal AI win: `+LARGE - distance` (prefer faster wins).
- Terminal loss: `-LARGE + distance` (prefer slower losses).
- Draw: `0`.
- Depth cutoff (non-terminal): game-specific **heuristic** `evaluate(state, AI)`.

**Move ordering** (improves pruning): Connect Four evaluates center columns first
(3,2,4,1,5,0,6). Tic-Tac-Toe ordering barely matters given the size.

### 3.1 Heuristics

- **Tic-Tac-Toe:** not really needed — the tree is fully searchable, so Hard always
  reaches terminal states. A simple line-potential heuristic exists only for shallow
  (Easy/Medium) depth cutoffs.
- **Connect Four `evaluate`:** score open windows of 4 cells:
  - `+100000` four AI discs (win), `+100` three AI + 1 empty, `+10` two AI + 2 empty.
  - Symmetric negatives for the opponent (weight opponent threats slightly higher to
    prefer blocking). Bonus for center-column control.

## 4. Difficulty Levels

Difficulty = **search depth** + **randomness / blunder rate**. Tuned per game so
each level *feels* right and Hard ≥ Medium ≥ Easy in strength (enforced by tests).

| Level | Behavior | Tic-Tac-Toe | Connect Four |
|-------|----------|-------------|--------------|
| **Easy** | Mostly weak; makes mistakes | ~70% random legal move, else depth-1 | depth 2, 40% random move |
| **Medium** | Decent, occasionally imperfect | depth 4, 15% random | depth 4–5, 10% random |
| **Hard** | Strong / near-optimal | full search (never loses) | depth 6–8, no randomness, move ordering |

Notes:
- "Random %" = probability of playing a uniformly random legal move instead of the
  minimax choice — a simple, legible way to weaken the AI without breaking legality.
- **Hard Tic-Tac-Toe is a solved game:** with full minimax it cannot lose; a perfect
  opponent forces at best a draw. This is expected and asserted in tests.
- Connect Four Hard depth is bounded by the < 500 ms move-time budget (PRD NFR).
  Start at depth 6; raise toward 8 if alpha-beta + ordering (and later bitboards)
  keep us within budget.

## 5. AI Placement & Per-Seat Bots

AI runs **server-side** (single authoritative code path; client stays thin). Because the
engine + minimax are shared TypeScript, moving it **client-side** later (for latency /
offload) is a drop-in swap with no rule duplication. See TDD §6.1.

The AI runner is a **pure, stateless** function `pickMove(state, gameModule, difficulty) →
move`. Difficulty is a property of the **seat**, not the room, so:
- A room can hold **bots at different levels** (e.g. Medium seat vs Hard seat).
- **Bot-vs-bot watch** rooms just have every seat as a bot; the server's turn loop runs
  `pickMove` for each seat in turn, paced (~600ms) so a human can watch.
- The engine/`GameModule` is **N-player generic**; the POC uses 2 seats, but the AI runner
  and minimax already take the acting player as a parameter, so teams / 3+ players are additive.

## 6. Test Assertions (from TDD §10)

- Win/draw detection correct for all lines in both games.
- Illegal moves rejected (full column, occupied cell, out of turn).
- Tic-Tac-Toe Hard never loses across an exhaustive/opponent-sampled set.
- Connect Four Hard beats a random player ≥ 95%.
- Monotonic strength: Hard beats Medium beats Easy over N simulated games.
- AI move computed within the PRD time budget at each level.
