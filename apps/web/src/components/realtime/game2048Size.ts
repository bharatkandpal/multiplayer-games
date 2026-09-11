// Persisted 2048 grid-size preference (MPG-096). A tiny local-only setting — the
// size is a customization, not server state — so it degrades to the default when
// storage is unavailable, exactly like the Drunk Walk character does. The chosen
// size selects which registered engine module (`2048` / `2048@3` / `2048@5`) the
// route plays, and therefore which leaderboard the run submits to.

import { DEFAULT_2048_SIZE, GAME_2048_SIZES, type Game2048Size } from "@mpg/engine";

const STORAGE_KEY = "mpg:2048:size";

function isValidSize(n: number): n is Game2048Size {
  return (GAME_2048_SIZES as readonly number[]).includes(n);
}

/** The player's stored board size, or the default when unset/unreadable. */
export function loadStored2048Size(): Game2048Size {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    if (isValidSize(n)) return n;
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return DEFAULT_2048_SIZE;
}

/** Persists the board size. Best-effort — a lost preference is not a failure. */
export function store2048Size(size: Game2048Size): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // Ignore — the next load simply returns the default.
  }
}
