/**
 * MPG-017: two browser contexts play a full Tic-Tac-Toe PvP game over one
 * shared invite link — room create → invite → join → alternating moves →
 * game:over → rematch. Each context is a genuinely separate session (its own
 * localStorage / socket handshake), exactly like two different players on
 * two different devices.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  clickCell,
  clickRematch,
  goToSetup,
  isBoardDisabled,
  joinViaInvite,
  playOnlineAndGetInviteUrl,
  waitForBoard,
  waitForGameOver,
} from "./helpers";

test.describe("PvP over a shared invite link (Tic-Tac-Toe)", () => {
  let creatorContext: BrowserContext;
  let joinerContext: BrowserContext;
  let creator: Page;
  let joiner: Page;

  test.beforeEach(async ({ browser }) => {
    creatorContext = await browser.newContext();
    joinerContext = await browser.newContext();
    creator = await creatorContext.newPage();
    joiner = await joinerContext.newPage();
  });

  test.afterEach(async () => {
    await creatorContext.close();
    await joinerContext.close();
  });

  test("both players complete a game and take a rematch", async () => {
    // 1. Player 1 creates a room and gets an invite link.
    await goToSetup(creator, "Tic-Tac-Toe");
    const inviteUrl = await playOnlineAndGetInviteUrl(creator);
    expect(inviteUrl).toContain("/tictactoe/room/");

    // 2. Player 2 opens the invite link in a wholly separate session.
    await joinViaInvite(joiner, inviteUrl);

    // 3. Both sides land on the board once the room fills.
    await waitForBoard(creator);
    await waitForBoard(joiner);

    // Seat 1 (the creator) is X and moves first — its board starts enabled,
    // the joiner's (seat 2, O) starts disabled until X moves.
    await expect(async () => {
      expect(await isBoardDisabled(creator)).toBe(false);
    }).toPass({ timeout: 5000 });
    expect(await isBoardDisabled(joiner)).toBe(true);

    // 4. Alternating moves to a known X win (top row): X, O, X, O, X.
    await clickCell(creator, { row: 1, col: 1 }); // X
    await expect(async () => expect(await isBoardDisabled(joiner)).toBe(false)).toPass();

    await clickCell(joiner, { row: 2, col: 1 }); // O
    await expect(async () => expect(await isBoardDisabled(creator)).toBe(false)).toPass();

    await clickCell(creator, { row: 1, col: 2 }); // X
    await expect(async () => expect(await isBoardDisabled(joiner)).toBe(false)).toPass();

    await clickCell(joiner, { row: 2, col: 2 }); // O
    await expect(async () => expect(await isBoardDisabled(creator)).toBe(false)).toPass();

    await clickCell(creator, { row: 1, col: 3 }); // X completes the top row.

    // 5. Both sides see the result (win for X / seat 1).
    const creatorResult = await waitForGameOver(creator);
    const joinerResult = await waitForGameOver(joiner);
    expect(creatorResult).toMatch(/wins!/i);
    expect(joinerResult).toMatch(/wins!/i);

    // Both boards lock once the game is over.
    expect(await isBoardDisabled(creator)).toBe(true);
    expect(await isBoardDisabled(joiner)).toBe(true);

    // 6. Rematch: creator proposes, joiner sees the prompt and accepts.
    await clickRematch(creator);
    await expect(creator.getByText(/waiting for opponent/i)).toBeVisible();
    await expect(joiner.getByText(/opponent wants a rematch/i)).toBeVisible();

    await clickRematch(joiner);

    // A fresh room starts for both — the board resets to empty.
    await waitForBoard(creator);
    await waitForBoard(joiner);
    await expect(creator.getByRole("gridcell", { name: /empty/ }).first()).toBeVisible();
    const emptyCellCount = await creator.getByRole("gridcell", { name: /empty/ }).count();
    expect(emptyCellCount).toBe(9);
  });

  test("opponent disconnect surfaces a waiting-to-reconnect banner", async () => {
    await goToSetup(creator, "Tic-Tac-Toe");
    const inviteUrl = await playOnlineAndGetInviteUrl(creator);
    await joinViaInvite(joiner, inviteUrl);

    await waitForBoard(creator);
    await waitForBoard(joiner);

    // The joiner disappears mid-game (closed tab, lost connection, ...).
    await joinerContext.close();

    await expect(creator.getByText(/opponent disconnected/i)).toBeVisible({ timeout: 10_000 });
  });
});
