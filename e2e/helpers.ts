/**
 * Shared Playwright helpers for the online (room-backed) flows (MPG-017).
 *
 * Kept deliberately thin and behavior-focused — every helper drives the app
 * exactly the way a player would (role/label selectors, no reaching into
 * internals), per the "prefer public interfaces" testing guidance in
 * `docs/TDD.md` §10.
 */

import { expect, type Locator, type Page } from "@playwright/test";

/** Row/column label the TicTacToeBoard cells use — 1-based, matches `cellLabel()`. */
export interface CellPos {
  row: number;
  col: number;
}

/**
 * Navigates Home → Setup for a given game title (e.g. "Tic-Tac-Toe").
 *
 * Goes via the card's "Options" control, not the card itself: tapping a card
 * now quick-starts a game against the bot, so Options is the only route to the
 * seat-configuration screen the online/PvP flows below depend on.
 */
export async function goToSetup(page: Page, gameTitle: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: `Options for ${gameTitle}`, exact: false }).click();
  await expect(page.getByRole("heading", { name: `Set up ${gameTitle}` })).toBeVisible();
}

/**
 * Fills and submits the first-run username picker if it's open (MPG-077 —
 * "Play online" and joining an invite link are both gated behind having a
 * name for this browser). Local-first by design: submitting dismisses the
 * modal immediately, no network wait involved. No-ops if the picker isn't
 * showing (e.g. this browser context already has a stored username).
 */
export async function fillUsernameIfPrompted(page: Page, name: string): Promise<void> {
  const input = page.locator("#username-input");
  // The modal only ever appears once, right after the gated action — a short
  // window is enough; a genuinely ungated flow just times out and no-ops.
  if (await input.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await input.fill(name);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(input).not.toBeVisible();
  }
}

/**
 * A username unique to this process/run — usernames are globally unique
 * server-side (MPG-077), and the local dev server persists across repeated
 * local `playwright test` invocations (`reuseExistingServer`), so a fixed
 * literal would 409-collide with itself on the second run.
 */
function uniqueUsername(role: "creator" | "joiner"): string {
  return `${role}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
}

/** Clicks "Play online" on the Setup screen and waits for the invite link to appear. */
export async function playOnlineAndGetInviteUrl(
  page: Page,
  username = uniqueUsername("creator"),
): Promise<string> {
  await page.getByRole("button", { name: "Play online" }).click();
  await fillUsernameIfPrompted(page, username);
  const linkInput = page.locator("#invite-url");
  await expect(linkInput).toBeVisible();
  // The input starts empty an instant before `room:create` resolves — wait
  // for the real URL rather than racing it.
  await expect(linkInput).not.toHaveValue("");
  return linkInput.inputValue();
}

/**
 * Dismisses the how-to-play sheet if it's open (MPG-138 shows it unasked the
 * first time a browser meets a game, and each context here is fresh). Escape is
 * how a player closes it, so that's what this does; no-ops when it isn't there.
 */
export async function dismissRulesIfShown(page: Page): Promise<void> {
  await dismissDialogIfShown(page);
}

/**
 * Closes whichever non-blocking prompt the app may have opened over the screen
 * — the rules sheet on a first meeting (MPG-138), or the claim-a-handle prompt
 * that follows a win (MPG-091-c). Both are enhancements layered over the game
 * and both close on Escape; a player dismisses them the same way. No-ops when
 * nothing is open.
 */
export async function dismissDialogIfShown(page: Page): Promise<void> {
  // Best-effort by design, and never an assertion: more than one prompt can be
  // up at once, and the claim-a-handle one arrives a beat late (it waits on a
  // backend probe), so "is a dialog open right now" is genuinely racy. Callers
  // that need the screen clear to *click* something use `clickPast` below,
  // which re-dismisses on each attempt instead of trusting a single look.
  for (let attempt = 0; attempt < 3; attempt++) {
    const dialog = page.getByRole("dialog").first();
    if (!(await dialog.isVisible({ timeout: 500 }).catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

/**
 * Clicks a control that one of those prompts may currently be covering,
 * dismissing whatever is in the way and retrying — the prompt can open between
 * the dismissal and the click, which is exactly the race a single
 * dismiss-then-click loses.
 */
export async function clickPast(page: Page, selector: Locator): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await dismissDialogIfShown(page);
    try {
      await selector.click({ timeout: 3_000 });
      return;
    } catch {
      // A prompt landed mid-click — dismiss it again and retry.
    }
  }
  await dismissDialogIfShown(page);
  await selector.click();
}

/** Opens an invite URL in a fresh page (own context) and waits for the board to appear. */
export async function joinViaInvite(
  page: Page,
  inviteUrl: string,
  username = uniqueUsername("joiner"),
): Promise<void> {
  await page.goto(inviteUrl);
  await fillUsernameIfPrompted(page, username);
  // JoinScreen ("Joining…") resolves into the board once seated.
  await expect(page.getByRole("grid")).toBeVisible({ timeout: 10_000 });
  await dismissRulesIfShown(page);
}

/** Waits until the game board is visible (creator side, once the room fills). */
export async function waitForBoard(page: Page): Promise<void> {
  await expect(page.getByRole("grid")).toBeVisible({ timeout: 10_000 });
  await dismissRulesIfShown(page);
}

/** Clicks a Tic-Tac-Toe cell by its 1-based row/column. */
export async function clickCell(page: Page, { row, col }: CellPos): Promise<void> {
  await clickPast(
    page,
    page.getByRole("gridcell", { name: new RegExp(`^Row ${row}, column ${col}, `) }),
  );
}

/** Reads a Tic-Tac-Toe cell's mark ("X" | "O" | "empty") from its accessible label. */
export async function cellMark(page: Page, { row, col }: CellPos): Promise<string> {
  const label = await page
    .getByRole("gridcell", { name: new RegExp(`^Row ${row}, column ${col}, `) })
    .getAttribute("aria-label");
  return label?.split(", ").pop() ?? "";
}

/** Waits until the aria-live status region announces the game is over, and returns its text. */
export async function waitForGameOver(page: Page): Promise<string> {
  const status = page.locator('[role="status"]');
  await expect(status).toContainText(/wins!|draw/i, { timeout: 10_000 });
  const text = await status.innerText();
  // A win can open the claim-a-handle prompt over the result actions.
  await dismissDialogIfShown(page);
  return text;
}

/** True once this client's board is disabled for input (opponent's turn / game over). */
export async function isBoardDisabled(page: Page): Promise<boolean> {
  const value = await page.getByRole("grid").getAttribute("aria-disabled");
  return value === "true";
}

/** Clicks Rematch and returns once this side has proposed one. */
export async function clickRematch(page: Page): Promise<void> {
  await clickPast(page, page.getByRole("button", { name: "Rematch" }));
}
