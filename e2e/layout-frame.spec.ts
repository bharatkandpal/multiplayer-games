/**
 * MPG-137 — the layout law, enforced (UX_PRINCIPLES §9, DESIGN_LANGUAGE §5).
 *
 * "The screen is the frame": at 320×568 and 390×844, no screen makes the page
 * scroll, and where content genuinely exceeds the frame exactly one *region*
 * scrolls inside it. This is a layout contract, so it can only be checked in a
 * real engine — jsdom has no layout, which is why MPG-136 shipped verified by
 * hand and the regression came straight back on the screens it didn't touch.
 */

import { test, expect, type Page } from "@playwright/test";
import { clickPast, dismissDialogIfShown } from "./helpers";

const FRAMES = [
  { name: "320x568", width: 320, height: 568 },
  { name: "390x844", width: 390, height: 844 },
] as const;

interface FrameReport {
  /** How far the page itself can scroll. Must be 0 — the page is the frame. */
  pageScrollY: number;
  pageScrollX: number;
  /** Elements that actually have something to scroll, and opt into scrolling. */
  scrollRegions: string[];
}

async function measure(page: Page): Promise<FrameReport> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const scrollRegions: string[] = [];
    document.querySelectorAll("*").forEach((node) => {
      const el = node as HTMLElement;
      const overflowY = getComputedStyle(el).overflowY;
      const overflowing = el.scrollHeight - el.clientHeight > 1;
      if (overflowing && (overflowY === "auto" || overflowY === "scroll")) {
        scrollRegions.push(`${el.tagName}.${el.className}`);
      }
    });
    return {
      pageScrollY: doc.scrollHeight - doc.clientHeight,
      pageScrollX: doc.scrollWidth - doc.clientWidth,
      scrollRegions,
    };
  });
}

/** The page must not scroll, in either axis, on any screen. */
function expectFramed(report: FrameReport, screen: string): void {
  expect(report.pageScrollY, `${screen}: the page scrolls vertically`).toBeLessThanOrEqual(0);
  expect(report.pageScrollX, `${screen}: the page scrolls horizontally`).toBeLessThanOrEqual(0);
}

for (const frame of FRAMES) {
  test.describe(`${frame.name}`, () => {
    test.use({ viewport: { width: frame.width, height: frame.height } });

    test("no screen makes the page scroll", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      expectFramed(await measure(page), "home");

      // Home is a catalogue and genuinely exceeds the frame — but it scrolls in
      // exactly one region, not as a page.
      const home = await measure(page);
      expect(home.scrollRegions.length, "home scrolls in more than one region").toBeLessThanOrEqual(
        1,
      );

      await page
        .getByRole("button", { name: /^Options for /, exact: false })
        .first()
        .click();
      await expect(page.getByRole("heading", { name: /^Set up/ })).toBeVisible();
      expectFramed(await measure(page), "setup");

      // One game from each family, including the tallest board in the catalogue.
      for (const slug of ["connect4", "gomoku", "tictactoe-move", "floppy-birds"]) {
        await page.goto(`/${slug}`);
        await expect(page.getByRole("button", { name: /Home/ }).first()).toBeVisible();
        await dismissDialogIfShown(page);
        const report = await measure(page);
        expectFramed(report, slug);
        // In-game nothing scrolls at all: the frame is top bar, board, bar.
        expect(report.scrollRegions, `${slug} has a scrolling region in-game`).toEqual([]);
      }
    });

    test("in-game, Home and the action bar are both in the frame", async ({ page }) => {
      await page.goto("/tictactoe");
      await dismissDialogIfShown(page);
      await expect(page.getByRole("button", { name: /Home/ }).first()).toBeInViewport();
      await expect(page.getByRole("grid")).toBeInViewport();
      // The pinned action bar is the frame's bottom edge (MPG-136).
      await expect(page.getByRole("navigation", { name: "Game navigation" })).toBeInViewport();
    });

    test("a finished game keeps its board and its next action in the frame", async ({ page }) => {
      await page.goto("/tictactoe");
      await dismissDialogIfShown(page);

      for (let attempt = 0; attempt < 20; attempt++) {
        if (await page.getByRole("button", { name: "Rematch" }).count()) break;
        const open = page.locator('[role="gridcell"]:not([aria-disabled="true"])');
        if ((await open.count()) === 0) {
          await page.waitForTimeout(300);
          continue;
        }
        await clickPast(page, open.first());
        await page.waitForTimeout(400);
      }
      await dismissDialogIfShown(page);

      expectFramed(await measure(page), "tictactoe game-over");
      // The board survives the arrival of the whole result stack, and Rematch —
      // the one primary action — is still where the player is looking.
      await expect(page.getByRole("grid")).toBeInViewport();
      await expect(page.getByRole("button", { name: "Rematch" })).toBeInViewport();
    });
  });
}
