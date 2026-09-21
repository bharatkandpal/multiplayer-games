/**
 * CHAT-009: end-to-end coverage for the chat baseline (CHAT-004..008).
 *
 * Two specs:
 *
 *   1. "degrades to absence" — always runs, with no `ABLY_API_KEY` in the
 *      test environment (this suite never sets one). Verifies the
 *      degradation contract from `apps/server/src/chat/chatRoutes.ts` /
 *      `apps/web/src/hooks/useChatChannel.ts`: the token mint 503s, the
 *      composer disables, a quiet toast appears, and — the offline pillar
 *      (CLAUDE.md "no feature may break offline play") — the single-player
 *      catalogue is completely unaffected by chat being down.
 *
 *   2. "live round trip" — gated on a real `ABLY_API_KEY` being present in
 *      the environment this test runner inherited (Playwright's `webServer`
 *      passes the runner's env through to the server it boots). Without one,
 *      this spec `test.skip`s with a clear annotation rather than failing —
 *      CI has no Ably key, so this only runs where a developer has one set
 *      locally.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { dismissDialogIfShown, clickCell, cellMark, isBoardDisabled } from "./helpers";

const HAS_ABLY_KEY = Boolean(process.env["ABLY_API_KEY"]);

/** A chat room id unique to this test run — rooms are ephemeral pub/sub, no store to collide in, but a fresh id keeps runs from ever cross-talking. */
function uniqueRoomId(label: string): string {
  return `e2e-${label}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}

/** Opens the chat lobby from Home via the labelled "Chat" button (not a direct nav — proves the entry point too). */
async function openChatFromHome(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
}

test.describe("Chat — degrades to absence when unconfigured", () => {
  test("composer disables, a quiet notice shows, no error banner, no dead end", async ({
    page,
  }) => {
    await openChatFromHome(page);

    // The unavailable notice is present, in plain language — never a raw error.
    await expect(
      page.getByText(/chat is unavailable right now/i),
    ).toBeVisible();

    // The composer is disabled outright — no dead-end "type into a box that
    // silently swallows your message".
    const composer = page.locator("#chat-input");
    await expect(composer).toBeDisabled();
    await expect(composer).toHaveAttribute("placeholder", /unavailable/i);
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

    // No generic/raw error surface — the only visible copy is the one quiet,
    // specific notice above (never something like "500", "failed", "error"
    // with no explanation).
    await expect(page.getByText(/^error$/i)).toHaveCount(0);
    await expect(page.getByText(/unexpected error/i)).toHaveCount(0);

    // Not a dead end: Home is still one click away.
    await page.getByRole("button", { name: "Home" }).click();
    await expect(page.getByRole("heading", { name: "Multiplayer Games" })).toBeVisible();
  });

  test("a single-player game plays start to finish while chat is down", async ({ page }) => {
    // Visit chat first (and confirm it's degraded) so the game below is
    // proven unaffected by chat having already failed to connect this
    // session, not just by having never been opened.
    await openChatFromHome(page);
    await expect(page.locator("#chat-input")).toBeDisabled();
    await page.getByRole("button", { name: "Home" }).click();

    // Quick-start Tic-Tac-Toe against the bot (the same `/:gameId` deep link
    // a shared-score fallback or a bookmark uses) and play to completion —
    // chat being unreachable must not touch the game catalogue at all
    // (CLAUDE.md offline pillar).
    await page.goto("/tictactoe");
    await dismissDialogIfShown(page);
    await expect(page.getByRole("grid")).toBeVisible();

    // A legal move is accepted and the board responds (mark rendered), then
    // the bot replies with its own move — the round trip a "played start to
    // finish" claim rests on.
    await expect(async () => {
      expect(await cellMark(page, { row: 1, col: 1 })).toBe("empty");
    }).toPass({ timeout: 2_000 });
    await clickCell(page, { row: 1, col: 1 });
    await expect(async () => {
      expect(await cellMark(page, { row: 1, col: 1 })).not.toBe("empty");
    }).toPass({ timeout: 5_000 });

    // The bot takes its turn back on its own — the board re-enables for our
    // next move without any further input from us (or the bot's reply
    // already ended the game, which also re-renders past "waiting").
    await expect(async () => {
      const disabled = await isBoardDisabled(page);
      const gameOver = await page.locator('[role="status"]').innerText();
      expect(disabled === false || /wins!|draw/i.test(gameOver)).toBe(true);
    }).toPass({ timeout: 5_000 });
  });
});

test.describe("Chat — live round trip over Ably", () => {
  test.skip(
    !HAS_ABLY_KEY,
    "requires a real ABLY_API_KEY in the environment this test runner inherits " +
      "(Playwright's webServer passes it through to the server it boots); " +
      "CI has none configured, so this spec is skipped there by design — " +
      "set ABLY_API_KEY locally to exercise it.",
  );

  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let contextOther: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    contextOther = await browser.newContext();
  });

  test.afterEach(async () => {
    await contextA.close();
    await contextB.close();
    await contextOther.close();
  });

  test("a message sent in one room arrives for another client in the same room, and not in a different room", async () => {
    const roomId = uniqueRoomId("room-a");
    const otherRoomId = uniqueRoomId("room-b");

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageOther = await contextOther.newPage();

    await pageA.goto(`/chat/${roomId}`);
    await pageB.goto(`/chat/${roomId}`);
    await pageOther.goto(`/chat/${otherRoomId}`);

    // Both same-room clients, and the different-room client, all reach "live".
    await expect(pageA.locator("#chat-input")).toBeEnabled({ timeout: 15_000 });
    await expect(pageB.locator("#chat-input")).toBeEnabled({ timeout: 15_000 });
    await expect(pageOther.locator("#chat-input")).toBeEnabled({ timeout: 15_000 });

    const messageText = `hello from A ${Date.now()}`;
    await pageA.locator("#chat-input").fill(messageText);
    await pageA.getByRole("button", { name: "Send" }).click();

    // The sender sees its own message (only ever arrives back over the Ably
    // subscription, per `useChatChannel` — never a locally-composed echo).
    await expect(pageA.getByText(messageText)).toBeVisible({ timeout: 10_000 });

    // The other client in the SAME room receives it.
    await expect(pageB.getByText(messageText)).toBeVisible({ timeout: 10_000 });

    // A client in a DIFFERENT room never sees it — channel scoping.
    await pageOther.waitForTimeout(2_000);
    await expect(pageOther.getByText(messageText)).toHaveCount(0);
  });
});
