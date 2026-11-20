// nano's screen on a phone: the document scrolls in the browser's own scroller, the title bar sticks to the top and
// the shortcuts to the bottom, the text is 16px, and nothing scrolls sideways or moves once the page has loaded.

import { expect, test } from "../support";
import { focused, key, openMinimal, sideways } from "./minimal";

for (const width of [320, 375, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 699 } });

    test("nothing scrolls sideways, and every line of text is 16px or more", async ({ page }) => {
      await openMinimal(page);
      expect(await sideways(page), "as loaded").toBe(0);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      expect(await sideways(page), "at the end").toBe(0);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll(".nano *")]
          .filter((el) => el.getClientRects().length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
          .filter((el) => !el.closest(".nano-sr") && parseFloat(getComputedStyle(el).fontSize) < 16)
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}: ${getComputedStyle(el).fontSize}`),
      );
      expect(small).toEqual([]);
    });

    test("the four shortcuts that work sit two to a row, each a finger's height, and fit", async ({ page }) => {
      await openMinimal(page);
      const keys = await page.locator(".nano-keys > *").evaluateAll((els) =>
        els
          .filter((el) => el.getClientRects().length)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { text: el.textContent?.trim() ?? "", top: Math.round(r.top), height: r.height, right: r.right };
          }),
      );
      expect(keys.map((k) => k.text)).toEqual(["^G Help", "^F Where Is", "^X Exit to the title menu", "^/ Go To Line"]);
      expect(new Set(keys.map((k) => k.top)).size, "two rows").toBe(2);
      for (const k of keys) {
        expect(k.height, k.text).toBeGreaterThanOrEqual(44);
        expect(k.right, k.text).toBeLessThanOrEqual(width);
      }
    });
  });
}

test.describe("the layout", () => {
  test("the document is the only thing that scrolls", async ({ page }) => {
    await openMinimal(page);
    const scrollers = await page.evaluate(() => {
      const found: string[] = [];
      for (const el of document.querySelectorAll("body *")) {
        const { overflowY } = getComputedStyle(el);
        if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) found.push(el.className);
      }
      const body = getComputedStyle(document.body);
      return {
        found,
        root: getComputedStyle(document.documentElement).overflowY,
        body: body.overflowY,
        position: body.position,
        tall: document.documentElement.scrollHeight > innerHeight,
      };
    });
    expect(scrollers.found).toEqual([]);
    expect(scrollers.root).not.toBe("hidden");
    expect(scrollers.body).not.toBe("hidden");
    expect(scrollers.position).not.toBe("fixed");
    expect(scrollers.tall).toBe(true);
  });

  test("while reading, the title bar stays at the top and the shortcuts at the bottom", async ({ page }) => {
    await openMinimal(page);
    await page.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2));
    const place = await page.evaluate(() => ({
      bar: document.querySelector(".nano-bar")?.getBoundingClientRect().top,
      foot: document.querySelector(".nano-foot")?.getBoundingClientRect().bottom,
      height: innerHeight,
    }));
    expect(place.bar).toBe(0);
    expect(Math.round(place.foot ?? 0)).toBe(place.height);
  });

  test("at the end of the page the last line is above the shortcuts, not under them", async ({ page }) => {
    await openMinimal(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const { last, foot } = await page.evaluate(() => ({
      last: [...document.querySelectorAll("main li, main p, main dd")].pop()?.getBoundingClientRect().bottom ?? Infinity,
      foot: document.querySelector(".nano-foot")?.getBoundingClientRect().top ?? 0,
    }));
    expect(last).toBeLessThanOrEqual(foot);
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

  test("nothing moves when the script arrives: Where Is is the same box before it works and after", async ({ page, browser }) => {
    await openMinimal(page);
    const live = await key(page, "Where Is").boundingBox();
    const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = test.info().project.use;
    const off = await browser.newContext({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent, javaScriptEnabled: false });
    const still = await off.newPage();
    await openMinimal(still, { live: false });
    const before = await still.locator(".nano-keys > span", { hasText: "Where Is" }).boundingBox();
    await off.close();
    expect(before).toEqual(live);
  });
});
