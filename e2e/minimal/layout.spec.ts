// The layout a phone's keyboard depends on. Safari itself rests the prompt above its keyboard bar, as long as the
// document is the scroller, the prompt is its last line and nothing is pinned to the bottom of the screen.

import { expect, test } from "../support";
import { offer, openMinimal, prompt, enter, focused, sideways } from "./minimal";

for (const width of [320, 375, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 699 } });

    test("nothing scrolls sideways, before or after commands print", async ({ page }) => {
      await openMinimal(page);
      expect(await sideways(page), "as loaded").toBe(0);
      for (const line of ["help", "ls -la", "neofetch", "cat projects/README.md", "cat about.md"]) {
        await enter(page, line);
        expect(await sideways(page), `after ${line}`).toBe(0);
      }
    });

    test("the prompt's text is 16px, so Safari does not zoom to it", async ({ page }) => {
      await openMinimal(page);
      const size = await prompt(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(16);
    });
  });
}

test.describe("the layout", () => {
  test("the document is the only thing that scrolls", async ({ page }) => {
    await openMinimal(page);
    const scrollers = await page.evaluate(() => {
      const found: string[] = [];
      for (const el of document.querySelectorAll("body, body *")) {
        const { overflowY } = getComputedStyle(el);
        if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) found.push(el.className);
      }
      const root = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      return { found, root: root.overflowY, body: body.overflowY, position: body.position, tall: document.documentElement.scrollHeight > innerHeight };
    });
    expect(scrollers.found).toEqual([]);
    expect(scrollers.root).not.toBe("hidden");
    expect(scrollers.body).not.toBe("hidden");
    expect(scrollers.position).not.toBe("fixed");
    expect(scrollers.tall).toBe(true);
  });

  test("the prompt row is the last thing in the document", async ({ page }) => {
    await openMinimal(page);
    const gap = () =>
      page.evaluate(() => {
        const form = document.querySelector(".mt-form");
        if (!form) throw new Error("no prompt");
        return document.documentElement.scrollHeight - (form.getBoundingClientRect().bottom + scrollY);
      });
    // Under it: the page's own bottom padding, and nothing else.
    expect(await gap()).toBeLessThanOrEqual(16);
    await offer(page, "help").tap();
    await expect(page.locator(".mt-log .mt-help")).not.toHaveCount(0);
    expect(await gap(), "after help").toBeLessThanOrEqual(16);
  });

  test("the page does not turn zooming off", async ({ page }) => {
    await openMinimal(page);
    await expect(page.locator("meta[name=viewport]")).not.toHaveAttribute("content", /user-scalable|maximum-scale/);
  });

  test("nothing takes focus when the page opens", async ({ page }) => {
    await openMinimal(page);
    expect(await focused(page)).toBe("BODY");
    expect(await page.evaluate(() => Math.round(scrollY))).toBe(0);
  });

  test("with the prompt focused, the only thing pinned is the title bar, at the top", async ({ page }) => {
    await openMinimal(page);
    const pinned = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((el) => ["fixed", "sticky"].includes(getComputedStyle(el).position) && el.getClientRects().length)
          .map((el) => el.className.split(" ").pop()),
      );
    // Scrolled a little, without focus: the jump button floats in the corner.
    await page.evaluate(() => window.scrollTo(0, 600));
    expect(await pinned()).toEqual(["mt-bar", "mt-jump"]);
    await prompt(page).focus();
    expect(await pinned()).toEqual(["mt-bar"]);
  });

  test("the suggestions are finger-sized", async ({ page }) => {
    await openMinimal(page);
    const boxes = await page.locator(".mt-offers button").evaluateAll((buttons) =>
      buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      }),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(6);
    for (const [w, h] of boxes) {
      expect(w, `${w}x${h}`).toBeGreaterThanOrEqual(44);
      expect(h, `${w}x${h}`).toBeGreaterThanOrEqual(44);
    }
  });
});
