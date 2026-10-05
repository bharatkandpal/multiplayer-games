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

/**
 * MPG-152 — the chat FAB is a floating control, so it must never sit on top of
 * another one. Returns the labels of every visible interactive control whose box
 * intersects the FAB's.
 */
async function controlsUnderChatFab(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fab = document.querySelector('button[aria-label="Open chat"]');
    if (!fab) return ["(chat fab not found)"];
    const f = fab.getBoundingClientRect();
    const hits: string[] = [];
    const sel = 'a[href], button, [role="button"], [role="gridcell"], input, select, textarea';
    document.querySelectorAll(sel).forEach((node) => {
      if (node === fab) return;
      const el = node as HTMLElement;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return;
      const overlaps = r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top;
      if (overlaps) {
        hits.push(el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName);
      }
    });
    return hits;
  });
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

      // MPG-152: the floating chat button must not sit on any of it.
      expect(await controlsUnderChatFab(page), "chat FAB covers a control (game-over)").toEqual([]);
      // "Next game" is in the frame and its centre actually hits it (not the FAB).
      const next = page.getByRole("button", { name: /Next game/ });
      await expect(next).toBeInViewport();
      expect(
        await next.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return el.contains(hit);
        }),
        "Next game is covered at its centre",
      ).toBe(true);
    });

    test("game-over end actions are fully visible and their content fits", async ({ page }) => {
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

      // MPG-153: "Play a friend" sat in a scroll region that shaved its border,
      // and its glyph/label touched. The whole box must sit inside the region
      // that clips it, and the label must not overflow the button.
      const friend = page.getByRole("button", { name: /Play a friend/ });
      await expect(friend).toBeInViewport();
      const fit = await friend.evaluate((el) => {
        const b = el.getBoundingClientRect();
        let region: HTMLElement | null = el.parentElement;
        while (region && getComputedStyle(region).overflowY === "visible") {
          region = region.parentElement;
        }
        const r = region ? region.getBoundingClientRect() : b;
        const content = el.querySelector("[class*=endActionContent]")!;
        const [glyph, label] = Array.from(content.children) as HTMLElement[];
        const g = glyph!.getBoundingClientRect();
        const l = label!.getBoundingClientRect();
        return {
          clipped: b.left < r.left || b.right > r.right || b.top < r.top || b.bottom > r.bottom,
          overflowsX: el.scrollWidth > el.clientWidth,
          gap: l.left - g.right,
        };
      });
      expect(fit.clipped, "Play a friend is clipped by its scroll region").toBe(false);
      expect(fit.overflowsX, "Play a friend content overflows its box").toBe(false);
      expect(fit.gap, "no space between the glyph and label").toBeGreaterThanOrEqual(4);
    });

    test("the chat FAB covers no control on Home or in-game", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      // Home scrolls, so a card may pass under the FAB mid-scroll — but at the end
      // of the shelf the last card must be reachable clear of it.
      await page.evaluate(() => {
        document.querySelectorAll("*").forEach((el) => {
          const o = getComputedStyle(el).overflowY;
          if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight) {
            el.scrollTop = el.scrollHeight;
          }
        });
      });
      expect(await controlsUnderChatFab(page), "chat FAB covers a control (home)").toEqual([]);

      await page.goto("/tictactoe");
      await dismissDialogIfShown(page);
      expect(await controlsUnderChatFab(page), "chat FAB covers a control (in-game)").toEqual([]);
    });
  });
}
