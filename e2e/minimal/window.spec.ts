// The desktop window: a Terminal window on the paper page, and the start it plays once.

import { expect, test } from "../support";
import { openMinimal, prompt } from "./minimal";

test.describe("the desktop window", { tag: "@desktop" }, () => {
  test("is centred on the page and no wider than the old header's", async ({ page }) => {
    await openMinimal(page);
    const box = await page.locator(".mt-win").boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box?.width).toBe(896);
    expect(Math.round(box?.x ?? -1)).toBe(Math.round((width - 896) / 2));
    // The prompt is the size of the text around it where a mouse types.
    const sizes = await page.evaluate(() => [
      getComputedStyle(document.querySelector("#prompt") as Element).fontSize,
      getComputedStyle(document.querySelector(".mt-cmd") as Element).fontSize,
    ]);
    expect(sizes[0]).toBe(sizes[1]);
  });

  test("the close light goes back to the title menu", async ({ page }) => {
    await openMinimal(page);
    const light = page.locator(".mt-bar .lights a");
    await expect(light).toHaveAttribute("href", "/");
    await expect(light).toHaveAttribute("aria-label", /title menu/);
  });
});

test.describe("the start", { tag: "@desktop" }, () => {
  // The start is an animation: these visitors have not asked for less motion.
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("plays once in a tab, and leaves the page finished", async ({ page }) => {
    // Note whether the page was ever stamped to play its start, from before its own scripts run. The document is
    // watched, not its root element: this runs before there is one.
    await page.addInitScript(() => {
      const w = window as unknown as { __start?: boolean };
      w.__start = false;
      new MutationObserver((changes) => {
        if (changes.some((c) => (c.target as Element).hasAttribute("data-mt-intro"))) w.__start = true;
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-mt-intro"] });
    });
    const played = () => page.evaluate(() => (window as unknown as { __start?: boolean }).__start);

    await openMinimal(page);
    expect(await played(), "the first load plays it").toBe(true);
    // When it is over the page is the finished one: the stamp is gone and the prompt can be used.
    await expect(page.locator("html")).not.toHaveAttribute("data-mt-intro", /.*/);
    await expect(prompt(page)).toBeVisible();
    await expect(page.locator("h2")).toHaveText(["Projects", "Contact", "Elsewhere on this site"]);

    await page.reload({ waitUntil: "networkidle" });
    expect(await played(), "a reload does not").toBe(false);
  });
});
