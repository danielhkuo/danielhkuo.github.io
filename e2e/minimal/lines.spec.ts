// nano shows whole lines only: no line of the text is ever half under the title bar or the status line. At any
// window size, as the page opens, after a scroll and after Go To Line.

import { expect, test } from "../support";
import { cutLines, goTo, key, openMinimal, settled } from "./minimal";

/** A scroll by `by` pixels, as a visitor makes one: the wheel at a desk; on a phone, the page's own scroll. */
async function scrollBy(page: import("@playwright/test").Page, by: number, desk: boolean): Promise<void> {
  if (desk) await page.mouse.wheel(0, by);
  else await page.evaluate((y) => window.scrollBy(0, y), by);
  await settled(page);
}

function checks(desk: boolean) {
  test("as the page opens, every line shown is whole", async ({ page }) => {
    await openMinimal(page);
    expect(await cutLines(page)).toEqual([]);
  });

  test("after a scroll, every line shown is whole", async ({ page }) => {
    await openMinimal(page);
    for (const by of [37, 100, 211]) {
      await scrollBy(page, by, desk);
      expect(await cutLines(page), `after a scroll of ${by}px more`).toEqual([]);
    }
  });

  test("after Go To Line, every line shown is whole", async ({ page }) => {
    await openMinimal(page);
    await key(page, "Go To Line").click();
    await goTo(page).getByRole("link", { name: /CONTACT/ }).click();
    await settled(page);
    expect(await cutLines(page)).toEqual([]);
  });
}

for (const [width, height] of [
  [390, 699],
  [375, 812],
  [320, 568],
]) {
  test.describe(`whole lines on a ${width}x${height} phone`, () => {
    test.use({ viewport: { width, height } });
    checks(false);
  });
}

for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1280, 720],
]) {
  test.describe(`whole lines in a ${width}x${height} window`, { tag: "@desktop" }, () => {
    test.use({ viewport: { width, height } });
    checks(true);
  });
}
